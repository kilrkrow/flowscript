var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/parser/lexer.ts
var SHAPE_KEYWORDS = new Set([
  "start",
  "end",
  "decision",
  "process",
  "subprocess",
  "io",
  "data",
  "circle",
  "note",
  "group",
  "lane",
  "manual",
  "delay"
]);
var DIRECTIVE_KEYS = new Set([
  "theme",
  "direction",
  "spacing",
  "font",
  "routing",
  "corner-radius",
  "connections"
]);
function tokenize(source) {
  const tokens = [];
  const lines = source.split(`
`);
  let inFrontmatter = false;
  let frontmatterSeen = false;
  for (let lineNum = 0;lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum];
    const line = lineNum + 1;
    if (rawLine.trim() === "---") {
      tokens.push({ type: "FRONTMATTER_DELIM", value: "---", line, col: 1 });
      if (!frontmatterSeen) {
        inFrontmatter = true;
        frontmatterSeen = true;
      } else {
        inFrontmatter = false;
      }
      tokens.push({ type: "NEWLINE", value: `
`, line, col: rawLine.length + 1 });
      continue;
    }
    if (inFrontmatter) {
      tokens.push({ type: "FRONTMATTER_LINE", value: rawLine.trim(), line, col: 1 });
      tokens.push({ type: "NEWLINE", value: `
`, line, col: rawLine.length + 1 });
      continue;
    }
    const indentMatch = rawLine.match(/^(\s+)/);
    if (indentMatch) {
      tokens.push({ type: "INDENT", value: indentMatch[1], line, col: 1 });
    }
    const trimmed = rawLine.trim();
    if (trimmed === "") {
      tokens.push({ type: "NEWLINE", value: `
`, line, col: 1 });
      continue;
    }
    if (trimmed.startsWith("//")) {
      tokens.push({ type: "COMMENT", value: trimmed.slice(2).trim(), line, col: rawLine.indexOf("//") + 1 });
      tokens.push({ type: "NEWLINE", value: `
`, line, col: rawLine.length + 1 });
      continue;
    }
    tokenizeLine(trimmed, line, rawLine.indexOf(trimmed) + 1, tokens);
    tokens.push({ type: "NEWLINE", value: `
`, line, col: rawLine.length + 1 });
  }
  tokens.push({ type: "EOF", value: "", line: lines.length + 1, col: 1 });
  return tokens;
}
function tokenizeLine(line, lineNum, baseCol, tokens) {
  let pos = 0;
  function col() {
    return baseCol + pos;
  }
  function peek() {
    return line[pos] ?? "";
  }
  function remaining() {
    return line.slice(pos);
  }
  function skipSpaces() {
    while (pos < line.length && (line[pos] === " " || line[pos] === "\t")) {
      pos++;
    }
  }
  while (pos < line.length) {
    skipSpaces();
    if (pos >= line.length)
      break;
    const c = col();
    if (peek() === "@") {
      pos++;
      const wordStart = pos;
      while (pos < line.length && /[a-zA-Z0-9_-]/.test(line[pos]))
        pos++;
      const word = line.slice(wordStart, pos);
      if (DIRECTIVE_KEYS.has(word)) {
        skipSpaces();
        const valueStart = pos;
        const value = line.slice(valueStart).trim();
        tokens.push({ type: "DIRECTIVE", value: `${word} ${value}`, line: lineNum, col: c });
        pos = line.length;
      } else {
        tokens.push({ type: "AT_ID", value: word, line: lineNum, col: c });
      }
      continue;
    }
    if (peek() === "#") {
      pos++;
      const wordStart = pos;
      while (pos < line.length && /[a-zA-Z]/.test(line[pos]))
        pos++;
      const word = line.slice(wordStart, pos).toLowerCase();
      if (SHAPE_KEYWORDS.has(word)) {
        tokens.push({ type: "SHAPE_KEYWORD", value: word, line: lineNum, col: c });
      } else {
        pos = wordStart - 1;
        const text2 = readTextSegment(line, pos, lineNum);
        tokens.push({ type: "TEXT", value: text2.value, line: lineNum, col: c });
        pos = text2.endPos;
      }
      continue;
    }
    if (peek() === "-" && line[pos + 1] === ">") {
      tokens.push({ type: "ARROW", value: "->", line: lineNum, col: c });
      pos += 2;
      continue;
    }
    if (peek() === ":") {
      tokens.push({ type: "COLON", value: ":", line: lineNum, col: c });
      pos++;
      continue;
    }
    if (peek() === ",") {
      tokens.push({ type: "COMMA", value: ",", line: lineNum, col: c });
      pos++;
      continue;
    }
    if (peek() === "{") {
      tokens.push({ type: "LBRACE", value: "{", line: lineNum, col: c });
      pos++;
      continue;
    }
    if (peek() === "}") {
      tokens.push({ type: "RBRACE", value: "}", line: lineNum, col: c });
      pos++;
      continue;
    }
    if (peek() === '"') {
      pos++;
      const strStart = pos;
      while (pos < line.length && line[pos] !== '"') {
        if (line[pos] === "\\")
          pos++;
        pos++;
      }
      const str = line.slice(strStart, pos);
      if (pos < line.length)
        pos++;
      tokens.push({ type: "STRING", value: str, line: lineNum, col: c });
      continue;
    }
    const text = readTextSegment(line, pos, lineNum);
    if (text.value) {
      tokens.push({ type: "TEXT", value: text.value, line: lineNum, col: c });
    }
    pos = text.endPos;
  }
}
function readTextSegment(line, startPos, _lineNum) {
  let pos = startPos;
  let text = "";
  while (pos < line.length) {
    if (line[pos] === ":" || line[pos] === "," || line[pos] === "{" || line[pos] === "}" || line[pos] === '"')
      break;
    if (line[pos] === "-" && line[pos + 1] === ">")
      break;
    if (line[pos] === "@" && pos > startPos)
      break;
    if (line[pos] === "#" && pos > startPos)
      break;
    if (line[pos] === "/" && line[pos + 1] === "/")
      break;
    text += line[pos];
    pos++;
  }
  return { value: text.trim(), endPos: pos };
}

// src/parser/parser.ts
class ParseError extends Error {
  line;
  col;
  constructor(message, line, col) {
    super(`Parse error at line ${line}, col ${col}: ${message}`);
    this.line = line;
    this.col = col;
    this.name = "ParseError";
  }
}
function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parse();
}

class Parser {
  pos = 0;
  tokens;
  doc;
  currentGroup = null;
  currentLane = null;
  implicitPrev = null;
  nodeCounter = 0;
  idMap = new Map;
  constructor(tokens) {
    this.tokens = tokens;
    this.doc = {
      meta: {},
      directives: [],
      nodes: new Map,
      edges: [],
      groups: [],
      lanes: []
    };
  }
  parse() {
    this.parseFrontmatter();
    this.parseBody();
    return this.doc;
  }
  peek() {
    return this.tokens[this.pos] ?? { type: "EOF", value: "", line: 0, col: 0 };
  }
  advance() {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }
  expect(type) {
    const t = this.peek();
    if (t.type !== type) {
      throw new ParseError(`Expected ${type}, got ${t.type} ("${t.value}")`, t.line, t.col);
    }
    return this.advance();
  }
  match(type) {
    if (this.peek().type === type)
      return this.advance();
    return null;
  }
  skipNewlines() {
    while (this.peek().type === "NEWLINE" || this.peek().type === "INDENT" || this.peek().type === "COMMENT") {
      this.advance();
    }
  }
  isAtEnd() {
    return this.peek().type === "EOF";
  }
  parseFrontmatter() {
    this.skipNewlines();
    if (this.peek().type !== "FRONTMATTER_DELIM")
      return;
    this.advance();
    this.match("NEWLINE");
    while (this.peek().type === "FRONTMATTER_LINE") {
      const line = this.advance().value;
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        this.doc.meta[key] = value;
      }
      this.match("NEWLINE");
    }
    if (this.peek().type === "FRONTMATTER_DELIM") {
      this.advance();
      this.match("NEWLINE");
    }
  }
  parseBody() {
    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd())
        break;
      const token = this.peek();
      if (token.type === "DIRECTIVE") {
        this.parseDirective();
      } else if (token.type === "SHAPE_KEYWORD" && token.value === "group") {
        this.parseGroup();
      } else if (token.type === "SHAPE_KEYWORD" && token.value === "lane") {
        this.parseLane();
      } else if (token.type === "SHAPE_KEYWORD") {
        this.parseShapedNode();
      } else if (token.type === "AT_ID") {
        this.parseAtIdLine();
      } else if (token.type === "TEXT") {
        this.parseTextLine();
      } else {
        this.advance();
      }
    }
  }
  parseDirective() {
    const token = this.advance();
    const spaceIdx = token.value.indexOf(" ");
    if (spaceIdx > 0) {
      const key = token.value.slice(0, spaceIdx);
      const value = token.value.slice(spaceIdx + 1).trim();
      this.doc.directives.push({ key, value });
    }
  }
  parseGroup() {
    this.advance();
    let label = "";
    if (this.peek().type === "TEXT") {
      label = this.advance().value;
    } else if (this.peek().type === "STRING") {
      label = this.advance().value;
    }
    const groupId = this.makeGroupId(label);
    const style = this.tryParseStyle();
    const group = {
      id: groupId,
      label,
      children: [],
      style: style || undefined
    };
    this.doc.groups.push(group);
    this.match("NEWLINE");
    const prevGroup = this.currentGroup;
    const prevImplicit = this.implicitPrev;
    this.currentGroup = groupId;
    this.implicitPrev = null;
    this.parseIndentedBlock(group);
    this.currentGroup = prevGroup;
    this.implicitPrev = prevImplicit;
  }
  parseIndentedBlock(group) {
    while (!this.isAtEnd()) {
      if (this.peek().type === "NEWLINE") {
        this.advance();
        continue;
      }
      if (this.peek().type === "COMMENT") {
        this.advance();
        continue;
      }
      if (this.peek().type !== "INDENT")
        break;
      this.advance();
      const token = this.peek();
      if (token.type === "SHAPE_KEYWORD") {
        const nodeId = this.parseShapedNode();
        if (nodeId)
          group.children.push(nodeId);
      } else if (token.type === "AT_ID") {
        const nodeId = this.parseAtIdLine();
        if (nodeId)
          group.children.push(nodeId);
      } else if (token.type === "TEXT") {
        const nodeId = this.parseTextLine();
        if (nodeId)
          group.children.push(nodeId);
      } else if (token.type === "COMMENT" || token.type === "NEWLINE") {
        this.advance();
      } else {
        break;
      }
    }
  }
  parseLane() {
    this.advance();
    let label = "";
    if (this.peek().type === "TEXT") {
      label = this.advance().value;
    } else if (this.peek().type === "STRING") {
      label = this.advance().value;
    }
    const laneId = `lane_${label.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const style = this.tryParseStyle();
    const lane = {
      id: laneId,
      label,
      children: [],
      style: style || undefined
    };
    this.doc.lanes.push(lane);
    this.match("NEWLINE");
    const prevLane = this.currentLane;
    const prevImplicit = this.implicitPrev;
    this.currentLane = laneId;
    this.implicitPrev = null;
    this.parseLaneBlock(lane);
    this.currentLane = prevLane;
    this.implicitPrev = prevImplicit;
  }
  parseLaneBlock(lane) {
    while (!this.isAtEnd()) {
      if (this.peek().type === "NEWLINE") {
        this.advance();
        continue;
      }
      if (this.peek().type === "COMMENT") {
        this.advance();
        continue;
      }
      if (this.peek().type !== "INDENT")
        break;
      this.advance();
      const token = this.peek();
      if (token.type === "SHAPE_KEYWORD") {
        const nodeId = this.parseShapedNode();
        if (nodeId)
          lane.children.push(nodeId);
      } else if (token.type === "AT_ID") {
        const nodeId = this.parseAtIdLine();
        if (nodeId)
          lane.children.push(nodeId);
      } else if (token.type === "TEXT") {
        const nodeId = this.parseTextLine();
        if (nodeId)
          lane.children.push(nodeId);
      } else if (token.type === "COMMENT" || token.type === "NEWLINE") {
        this.advance();
      } else {
        break;
      }
    }
  }
  parseShapedNode() {
    const shapeToken = this.advance();
    const shape = shapeToken.value;
    let label = "";
    if (this.peek().type === "TEXT") {
      label = this.advance().value;
    } else if (this.peek().type === "STRING") {
      label = this.advance().value;
    }
    if (!label) {
      label = shape.charAt(0).toUpperCase() + shape.slice(1);
    }
    const nodeId = this.ensureNode(label, shape);
    const style = this.tryParseStyle();
    if (style) {
      const node = this.doc.nodes.get(nodeId);
      node.style = { ...node.style, ...style };
    }
    this.parseInlineConnections(nodeId);
    if (this.implicitPrev && shape !== "start") {
      this.addEdge(this.implicitPrev, nodeId);
    }
    this.implicitPrev = nodeId;
    if (shape === "decision") {
      this.parseDecisionBranches(nodeId);
    }
    return nodeId;
  }
  parseTextLine() {
    const label = this.advance().value;
    if (!label)
      return null;
    const isExistingNode = this.nodeExistsByLabel(label);
    const nodeId = this.ensureNode(label, "process");
    const style = this.tryParseStyle();
    if (style) {
      const node = this.doc.nodes.get(nodeId);
      node.style = { ...node.style, ...style };
    }
    const hasExplicitConnection = this.peek().type === "ARROW";
    this.parseInlineConnections(nodeId);
    const isReferenceLine = isExistingNode && hasExplicitConnection;
    if (this.implicitPrev && !isReferenceLine) {
      this.addEdge(this.implicitPrev, nodeId);
    }
    if (hasExplicitConnection) {
      this.implicitPrev = null;
    } else {
      this.implicitPrev = nodeId;
    }
    return nodeId;
  }
  parseAtIdLine() {
    const idToken = this.advance();
    const atId = idToken.value;
    let shape = "process";
    if (this.peek().type === "SHAPE_KEYWORD") {
      shape = this.advance().value;
    }
    let label = "";
    if (this.peek().type === "TEXT") {
      label = this.advance().value;
    } else if (this.peek().type === "STRING") {
      label = this.advance().value;
    }
    if (!label)
      label = atId;
    const nodeId = this.ensureNode(label, shape);
    this.idMap.set(atId, nodeId);
    const style = this.tryParseStyle();
    if (style) {
      const node = this.doc.nodes.get(nodeId);
      node.style = { ...node.style, ...style };
    }
    this.parseInlineConnections(nodeId);
    if (this.implicitPrev) {
      this.addEdge(this.implicitPrev, nodeId);
    }
    this.implicitPrev = nodeId;
    return nodeId;
  }
  parseInlineConnections(fromId) {
    while (this.peek().type === "ARROW") {
      this.advance();
      let condition;
      let label;
      const saved = this.pos;
      if (this.peek().type === "TEXT") {
        const maybeCondition = this.peek().value;
        const isShortCondition = maybeCondition.length <= 10 && !this.nodeExistsByLabel(maybeCondition);
        if (isShortCondition) {
          this.advance();
          if (this.peek().type === "COLON") {
            this.advance();
            condition = maybeCondition;
          } else {
            this.pos = saved;
          }
        }
      }
      let targetLabel = "";
      let targetShape = "process";
      if (this.peek().type === "AT_ID") {
        const refId = this.advance().value;
        const resolvedId = this.idMap.get(refId);
        if (resolvedId) {
          if (this.peek().type === "COLON") {
            this.advance();
            if (this.peek().type === "STRING")
              label = this.advance().value;
            else if (this.peek().type === "TEXT")
              label = this.advance().value;
          }
          this.addEdge(fromId, resolvedId, label, condition);
          this.implicitPrev = resolvedId;
          if (this.peek().type === "COMMA") {
            this.advance();
            continue;
          }
          return;
        }
        targetLabel = refId;
      } else if (this.peek().type === "SHAPE_KEYWORD") {
        targetShape = this.advance().value;
        if (this.peek().type === "TEXT")
          targetLabel = this.advance().value;
        else if (this.peek().type === "STRING")
          targetLabel = this.advance().value;
        else
          targetLabel = targetShape.charAt(0).toUpperCase() + targetShape.slice(1);
      } else if (this.peek().type === "TEXT") {
        targetLabel = this.advance().value;
      } else if (this.peek().type === "STRING") {
        targetLabel = this.advance().value;
      }
      if (!targetLabel)
        continue;
      const targetId = this.ensureNode(targetLabel, targetShape);
      if (this.peek().type === "COLON") {
        this.advance();
        if (this.peek().type === "STRING")
          label = this.advance().value;
        else if (this.peek().type === "TEXT")
          label = this.advance().value;
      }
      this.addEdge(fromId, targetId, label, condition);
      this.implicitPrev = targetId;
      if (this.peek().type === "COMMA") {
        this.advance();
        continue;
      }
      break;
    }
  }
  parseDecisionBranches(decisionId) {
    const saved = this.pos;
    while (this.peek().type === "NEWLINE")
      this.advance();
    while (this.peek().type === "INDENT") {
      const indentPos = this.pos;
      this.advance();
      if (this.peek().type === "ARROW") {
        this.advance();
        let condition;
        let label;
        if (this.peek().type === "TEXT") {
          const maybeCondition = this.peek().value;
          const savedInner = this.pos;
          this.advance();
          if (this.peek().type === "COLON") {
            this.advance();
            condition = maybeCondition;
          } else {
            this.pos = savedInner;
          }
        }
        let targetLabel = "";
        let targetShape = "process";
        if (this.peek().type === "SHAPE_KEYWORD") {
          targetShape = this.advance().value;
          if (this.peek().type === "TEXT")
            targetLabel = this.advance().value;
          else if (this.peek().type === "STRING")
            targetLabel = this.advance().value;
        } else if (this.peek().type === "TEXT") {
          targetLabel = this.advance().value;
        } else if (this.peek().type === "STRING") {
          targetLabel = this.advance().value;
        } else if (this.peek().type === "AT_ID") {
          const refId = this.advance().value;
          const resolvedId = this.idMap.get(refId);
          targetLabel = resolvedId ?? refId;
        }
        if (!targetLabel)
          continue;
        const targetId = this.ensureNode(targetLabel, targetShape);
        if (this.peek().type === "COLON") {
          this.advance();
          if (this.peek().type === "STRING")
            label = this.advance().value;
          else if (this.peek().type === "TEXT")
            label = this.advance().value;
        }
        this.addEdge(decisionId, targetId, label, condition);
        while (this.peek().type === "NEWLINE")
          this.advance();
      } else {
        this.pos = indentPos;
        break;
      }
    }
  }
  tryParseStyle() {
    if (this.peek().type !== "LBRACE")
      return null;
    this.advance();
    const style = {};
    while (this.peek().type !== "RBRACE" && !this.isAtEnd()) {
      if (this.peek().type === "TEXT") {
        const key = this.advance().value;
        if (this.peek().type === "COLON") {
          this.advance();
          let value = "";
          if (this.peek().type === "STRING")
            value = this.advance().value;
          else if (this.peek().type === "TEXT")
            value = this.advance().value;
          switch (key.toLowerCase()) {
            case "fill":
              style.fill = value;
              break;
            case "stroke":
              style.stroke = value;
              break;
            case "text":
              style.text = value;
              break;
            case "border":
              style.border = value;
              break;
          }
        }
      }
      if (this.peek().type === "COMMA")
        this.advance();
      if (this.peek().type === "NEWLINE")
        this.advance();
    }
    this.match("RBRACE");
    return Object.keys(style).length > 0 ? style : null;
  }
  ensureNode(label, shape) {
    for (const [id2, node2] of this.doc.nodes) {
      if (node2.label === label) {
        if (shape !== "process" && node2.shape === "process") {
          node2.shape = shape;
        }
        return id2;
      }
    }
    this.nodeCounter++;
    const id = `n${this.nodeCounter}`;
    const node = {
      id,
      label,
      shape,
      group: this.currentGroup ?? undefined,
      lane: this.currentLane ?? undefined
    };
    this.doc.nodes.set(id, node);
    return id;
  }
  addEdge(from, to, label, condition) {
    const exists = this.doc.edges.some((e) => e.from === from && e.to === to && e.condition === condition);
    if (exists)
      return;
    this.doc.edges.push({
      from,
      to,
      label,
      condition
    });
  }
  nodeExistsByLabel(label) {
    for (const [_, node] of this.doc.nodes) {
      if (node.label === label)
        return true;
    }
    return false;
  }
  makeGroupId(label) {
    return `g_${label.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
  }
}
// node_modules/@dagrejs/dagre/dist/dagre.esm.js
var exports_dagre_esm = {};
__export(exports_dagre_esm, {
  version: () => U,
  util: () => xo,
  layout: () => he,
  graphlib: () => z,
  default: () => To,
  debug: () => fe,
  Graph: () => p
});
var ge = Object.defineProperty;
var hn = (e, n, t) => (n in e) ? ge(e, n, { enumerable: true, configurable: true, writable: true, value: t }) : e[n] = t;
var fn = (e, n) => {
  for (var t in n)
    ge(e, t, { get: n[t], enumerable: true });
};
var pe = (e, n, t) => hn(e, typeof n != "symbol" ? n + "" : n, t);
var z = {};
fn(z, { Graph: () => p, alg: () => R, json: () => ye, version: () => pn });
var bn = Object.defineProperty;
var Le = (e, n) => {
  for (var t in n)
    bn(e, t, { get: n[t], enumerable: true });
};
var p = class {
  constructor(e) {
    this._isDirected = true, this._isMultigraph = false, this._isCompound = false, this._nodes = {}, this._in = {}, this._preds = {}, this._out = {}, this._sucs = {}, this._edgeObjs = {}, this._edgeLabels = {}, this._nodeCount = 0, this._edgeCount = 0, this._defaultNodeLabelFn = () => {}, this._defaultEdgeLabelFn = () => {}, e && (this._isDirected = ("directed" in e) ? e.directed : true, this._isMultigraph = ("multigraph" in e) ? e.multigraph : false, this._isCompound = ("compound" in e) ? e.compound : false), this._isCompound && (this._parent = {}, this._children = {}, this._children["\x00"] = {});
  }
  isDirected() {
    return this._isDirected;
  }
  isMultigraph() {
    return this._isMultigraph;
  }
  isCompound() {
    return this._isCompound;
  }
  setGraph(e) {
    return this._label = e, this;
  }
  graph() {
    return this._label;
  }
  setDefaultNodeLabel(e) {
    return typeof e != "function" ? this._defaultNodeLabelFn = () => e : this._defaultNodeLabelFn = e, this;
  }
  nodeCount() {
    return this._nodeCount;
  }
  nodes() {
    return Object.keys(this._nodes);
  }
  sources() {
    return this.nodes().filter((e) => Object.keys(this._in[e]).length === 0);
  }
  sinks() {
    return this.nodes().filter((e) => Object.keys(this._out[e]).length === 0);
  }
  setNodes(e, n) {
    return e.forEach((t) => {
      n !== undefined ? this.setNode(t, n) : this.setNode(t);
    }), this;
  }
  setNode(e, n) {
    return e in this._nodes ? (arguments.length > 1 && (this._nodes[e] = n), this) : (this._nodes[e] = arguments.length > 1 ? n : this._defaultNodeLabelFn(e), this._isCompound && (this._parent[e] = "\x00", this._children[e] = {}, this._children["\x00"][e] = true), this._in[e] = {}, this._preds[e] = {}, this._out[e] = {}, this._sucs[e] = {}, ++this._nodeCount, this);
  }
  node(e) {
    return this._nodes[e];
  }
  hasNode(e) {
    return e in this._nodes;
  }
  removeNode(e) {
    if (e in this._nodes) {
      let n = (t) => this.removeEdge(this._edgeObjs[t]);
      delete this._nodes[e], this._isCompound && (this._removeFromParentsChildList(e), delete this._parent[e], this.children(e).forEach((t) => {
        this.setParent(t);
      }), delete this._children[e]), Object.keys(this._in[e]).forEach(n), delete this._in[e], delete this._preds[e], Object.keys(this._out[e]).forEach(n), delete this._out[e], delete this._sucs[e], --this._nodeCount;
    }
    return this;
  }
  setParent(e, n) {
    if (!this._isCompound)
      throw new Error("Cannot set parent in a non-compound graph");
    if (n === undefined)
      n = "\x00";
    else {
      n += "";
      for (let t = n;t !== undefined; t = this.parent(t))
        if (t === e)
          throw new Error("Setting " + n + " as parent of " + e + " would create a cycle");
      this.setNode(n);
    }
    return this.setNode(e), this._removeFromParentsChildList(e), this._parent[e] = n, this._children[n][e] = true, this;
  }
  parent(e) {
    if (this._isCompound) {
      let n = this._parent[e];
      if (n !== "\x00")
        return n;
    }
  }
  children(e = "\x00") {
    if (this._isCompound) {
      let n = this._children[e];
      if (n)
        return Object.keys(n);
    } else {
      if (e === "\x00")
        return this.nodes();
      if (this.hasNode(e))
        return [];
    }
    return [];
  }
  predecessors(e) {
    let n = this._preds[e];
    if (n)
      return Object.keys(n);
  }
  successors(e) {
    let n = this._sucs[e];
    if (n)
      return Object.keys(n);
  }
  neighbors(e) {
    let n = this.predecessors(e);
    if (n) {
      let t = new Set(n);
      for (let r of this.successors(e))
        t.add(r);
      return Array.from(t.values());
    }
  }
  isLeaf(e) {
    let n;
    return this.isDirected() ? n = this.successors(e) : n = this.neighbors(e), n.length === 0;
  }
  filterNodes(e) {
    let n = new this.constructor({ directed: this._isDirected, multigraph: this._isMultigraph, compound: this._isCompound });
    n.setGraph(this.graph()), Object.entries(this._nodes).forEach(([o, i]) => {
      e(o) && n.setNode(o, i);
    }), Object.values(this._edgeObjs).forEach((o) => {
      n.hasNode(o.v) && n.hasNode(o.w) && n.setEdge(o, this.edge(o));
    });
    let t = {}, r = (o) => {
      let i = this.parent(o);
      return !i || n.hasNode(i) ? (t[o] = i != null ? i : undefined, i != null ? i : undefined) : (i in t) ? t[i] : r(i);
    };
    return this._isCompound && n.nodes().forEach((o) => n.setParent(o, r(o))), n;
  }
  setDefaultEdgeLabel(e) {
    return typeof e != "function" ? this._defaultEdgeLabelFn = () => e : this._defaultEdgeLabelFn = e, this;
  }
  edgeCount() {
    return this._edgeCount;
  }
  edges() {
    return Object.values(this._edgeObjs);
  }
  setPath(e, n) {
    return e.reduce((t, r) => (n !== undefined ? this.setEdge(t, r, n) : this.setEdge(t, r), r)), this;
  }
  setEdge(e, n, t, r) {
    let o, i, s, a, d = false;
    typeof e == "object" && e !== null && "v" in e ? (o = e.v, i = e.w, s = e.name, arguments.length === 2 && (a = n, d = true)) : (o = e, i = n, s = r, arguments.length > 2 && (a = t, d = true)), o = "" + o, i = "" + i, s !== undefined && (s = "" + s);
    let l = C(this._isDirected, o, i, s);
    if (l in this._edgeLabels)
      return d && (this._edgeLabels[l] = a), this;
    if (s !== undefined && !this._isMultigraph)
      throw new Error("Cannot set a named edge when isMultigraph = false");
    this.setNode(o), this.setNode(i), this._edgeLabels[l] = d ? a : this._defaultEdgeLabelFn(o, i, s);
    let u = gn(this._isDirected, o, i, s);
    return o = u.v, i = u.w, Object.freeze(u), this._edgeObjs[l] = u, me(this._preds[i], o), me(this._sucs[o], i), this._in[i][l] = u, this._out[o][l] = u, this._edgeCount++, this;
  }
  edge(e, n, t) {
    let r = arguments.length === 1 ? Y(this._isDirected, e) : C(this._isDirected, e, n, t);
    return this._edgeLabels[r];
  }
  edgeAsObj(e, n, t) {
    let r = arguments.length === 1 ? this.edge(e) : this.edge(e, n, t);
    return typeof r != "object" ? { label: r } : r;
  }
  hasEdge(e, n, t) {
    return (arguments.length === 1 ? Y(this._isDirected, e) : C(this._isDirected, e, n, t)) in this._edgeLabels;
  }
  removeEdge(e, n, t) {
    let r = arguments.length === 1 ? Y(this._isDirected, e) : C(this._isDirected, e, n, t), o = this._edgeObjs[r];
    if (o) {
      let { v: i, w: s } = o;
      delete this._edgeLabels[r], delete this._edgeObjs[r], Ee(this._preds[s], i), Ee(this._sucs[i], s), delete this._in[s][r], delete this._out[i][r], this._edgeCount--;
    }
    return this;
  }
  inEdges(e, n) {
    return this.isDirected() ? this.filterEdges(this._in[e], e, n) : this.nodeEdges(e, n);
  }
  outEdges(e, n) {
    return this.isDirected() ? this.filterEdges(this._out[e], e, n) : this.nodeEdges(e, n);
  }
  nodeEdges(e, n) {
    if (e in this._nodes)
      return this.filterEdges({ ...this._in[e], ...this._out[e] }, e, n);
  }
  _removeFromParentsChildList(e) {
    delete this._children[this._parent[e]][e];
  }
  filterEdges(e, n, t) {
    if (!e)
      return;
    let r = Object.values(e);
    return t ? r.filter((o) => o.v === n && o.w === t || o.v === t && o.w === n) : r;
  }
};
function me(e, n) {
  e[n] ? e[n]++ : e[n] = 1;
}
function Ee(e, n) {
  e[n] !== undefined && !--e[n] && delete e[n];
}
function C(e, n, t, r) {
  let o = "" + n, i = "" + t;
  if (!e && o > i) {
    let s = o;
    o = i, i = s;
  }
  return o + "\x01" + i + "\x01" + (r === undefined ? "\x00" : r);
}
function gn(e, n, t, r) {
  let o = "" + n, i = "" + t;
  if (!e && o > i) {
    let a = o;
    o = i, i = a;
  }
  let s = { v: o, w: i };
  return r && (s.name = r), s;
}
function Y(e, n) {
  return C(e, n.v, n.w, n.name);
}
var pn = "4.0.1";
var ye = {};
Le(ye, { read: () => yn, write: () => mn });
function mn(e) {
  let n = { options: { directed: e.isDirected(), multigraph: e.isMultigraph(), compound: e.isCompound() }, nodes: En(e), edges: Ln(e) }, t = e.graph();
  return t !== undefined && (n.value = structuredClone(t)), n;
}
function En(e) {
  return e.nodes().map((n) => {
    let t = e.node(n), r = e.parent(n), o = { v: n };
    return t !== undefined && (o.value = t), r !== undefined && (o.parent = r), o;
  });
}
function Ln(e) {
  return e.edges().map((n) => {
    let t = e.edge(n), r = { v: n.v, w: n.w };
    return n.name !== undefined && (r.name = n.name), t !== undefined && (r.value = t), r;
  });
}
function yn(e) {
  let n = new p(e.options);
  return e.value !== undefined && n.setGraph(e.value), e.nodes.forEach((t) => {
    n.setNode(t.v, t.value), t.parent && n.setParent(t.v, t.parent);
  }), e.edges.forEach((t) => {
    n.setEdge({ v: t.v, w: t.w, name: t.name }, t.value);
  }), n;
}
var R = {};
Le(R, { CycleException: () => D, bellmanFord: () => we, components: () => Gn, dijkstra: () => F, dijkstraAll: () => _n, findCycles: () => xn, floydWarshall: () => On, isAcyclic: () => Cn, postorder: () => Pn, preorder: () => Mn, prim: () => jn, shortestPaths: () => Sn, tarjan: () => Ge, topsort: () => ke });
var wn = () => 1;
function we(e, n, t, r) {
  return Nn(e, String(n), t || wn, r || function(o) {
    return e.outEdges(o);
  });
}
function Nn(e, n, t, r) {
  let o = {}, i, s = 0, a = e.nodes(), d = function(c) {
    let h = t(c);
    o[c.v].distance + h < o[c.w].distance && (o[c.w] = { distance: o[c.v].distance + h, predecessor: c.v }, i = true);
  }, l = function() {
    a.forEach(function(c) {
      r(c).forEach(function(h) {
        let f = h.v === c ? h.v : h.w, g = f === h.v ? h.w : h.v;
        d({ v: f, w: g });
      });
    });
  };
  a.forEach(function(c) {
    let h = c === n ? 0 : Number.POSITIVE_INFINITY;
    o[c] = { distance: h, predecessor: "" };
  });
  let u = a.length;
  for (let c = 1;c < u && (i = false, s++, l(), !!i); c++)
    ;
  if (s === u - 1 && (i = false, l(), i))
    throw new Error("The graph contains a negative weight cycle");
  return o;
}
function Gn(e) {
  let n = {}, t = [], r;
  function o(i) {
    i in n || (n[i] = true, r.push(i), e.successors(i).forEach(o), e.predecessors(i).forEach(o));
  }
  return e.nodes().forEach(function(i) {
    r = [], o(i), r.length && t.push(r);
  }), t;
}
var Ne = class {
  constructor() {
    this._arr = [], this._keyIndices = {};
  }
  size() {
    return this._arr.length;
  }
  keys() {
    return this._arr.map((e) => e.key);
  }
  has(e) {
    return e in this._keyIndices;
  }
  priority(e) {
    let n = this._keyIndices[e];
    if (n !== undefined)
      return this._arr[n].priority;
  }
  min() {
    if (this.size() === 0)
      throw new Error("Queue underflow");
    return this._arr[0].key;
  }
  add(e, n) {
    let t = this._keyIndices, r = String(e);
    if (!(r in t)) {
      let o = this._arr, i = o.length;
      return t[r] = i, o.push({ key: r, priority: n }), this._decrease(i), true;
    }
    return false;
  }
  removeMin() {
    this._swap(0, this._arr.length - 1);
    let e = this._arr.pop();
    return delete this._keyIndices[e.key], this._heapify(0), e.key;
  }
  decrease(e, n) {
    let t = this._keyIndices[e];
    if (t === undefined)
      throw new Error(`Key not found: ${e}`);
    let r = this._arr[t].priority;
    if (n > r)
      throw new Error(`New priority is greater than current priority. Key: ${e} Old: ${r} New: ${n}`);
    this._arr[t].priority = n, this._decrease(t);
  }
  _heapify(e) {
    let n = this._arr, t = 2 * e, r = t + 1, o = e;
    t < n.length && (o = n[t].priority < n[o].priority ? t : o, r < n.length && (o = n[r].priority < n[o].priority ? r : o), o !== e && (this._swap(e, o), this._heapify(o)));
  }
  _decrease(e) {
    let n = this._arr, t = n[e].priority, r;
    for (;e !== 0 && (r = e >> 1, !(n[r].priority < t)); )
      this._swap(e, r), e = r;
  }
  _swap(e, n) {
    let t = this._arr, r = this._keyIndices, o = t[e], i = t[n];
    t[e] = i, t[n] = o, r[i.key] = e, r[o.key] = n;
  }
};
var kn = () => 1;
function F(e, n, t, r) {
  let o = function(i) {
    return e.outEdges(i);
  };
  return vn(e, String(n), t || kn, r || o);
}
function vn(e, n, t, r) {
  let o = {}, i = new Ne, s, a, d = function(l) {
    let u = l.v !== s ? l.v : l.w, c = o[u], h = t(l), f = a.distance + h;
    if (h < 0)
      throw new Error("dijkstra does not allow negative edge weights. Bad edge: " + l + " Weight: " + h);
    f < c.distance && (c.distance = f, c.predecessor = s, i.decrease(u, f));
  };
  for (e.nodes().forEach(function(l) {
    let u = l === n ? 0 : Number.POSITIVE_INFINITY;
    o[l] = { distance: u, predecessor: "" }, i.add(l, u);
  });i.size() > 0 && (s = i.removeMin(), a = o[s], a.distance !== Number.POSITIVE_INFINITY); )
    r(s).forEach(d);
  return o;
}
function _n(e, n, t) {
  return e.nodes().reduce(function(r, o) {
    return r[o] = F(e, o, n, t), r;
  }, {});
}
function Ge(e) {
  let n = 0, t = [], r = {}, o = [];
  function i(s) {
    let a = r[s] = { onStack: true, lowlink: n, index: n++ };
    if (t.push(s), e.successors(s).forEach(function(d) {
      d in r ? r[d].onStack && (a.lowlink = Math.min(a.lowlink, r[d].index)) : (i(d), a.lowlink = Math.min(a.lowlink, r[d].lowlink));
    }), a.lowlink === a.index) {
      let d = [], l;
      do
        l = t.pop(), r[l].onStack = false, d.push(l);
      while (s !== l);
      o.push(d);
    }
  }
  return e.nodes().forEach(function(s) {
    s in r || i(s);
  }), o;
}
function xn(e) {
  return Ge(e).filter(function(n) {
    return n.length > 1 || n.length === 1 && e.hasEdge(n[0], n[0]);
  });
}
var Tn = () => 1;
function On(e, n, t) {
  return In(e, n || Tn, t || function(r) {
    return e.outEdges(r);
  });
}
function In(e, n, t) {
  let r = {}, o = e.nodes();
  return o.forEach(function(i) {
    r[i] = {}, r[i][i] = { distance: 0, predecessor: "" }, o.forEach(function(s) {
      i !== s && (r[i][s] = { distance: Number.POSITIVE_INFINITY, predecessor: "" });
    }), t(i).forEach(function(s) {
      let a = s.v === i ? s.w : s.v, d = n(s);
      r[i][a] = { distance: d, predecessor: i };
    });
  }), o.forEach(function(i) {
    let s = r[i];
    o.forEach(function(a) {
      let d = r[a];
      o.forEach(function(l) {
        let u = d[i], c = s[l], h = d[l], f = u.distance + c.distance;
        f < h.distance && (h.distance = f, h.predecessor = c.predecessor);
      });
    });
  }), r;
}
var D = class extends Error {
  constructor(...e) {
    super(...e);
  }
};
function ke(e) {
  let n = {}, t = {}, r = [];
  function o(i) {
    if (i in t)
      throw new D;
    i in n || (t[i] = true, n[i] = true, e.predecessors(i).forEach(o), delete t[i], r.push(i));
  }
  if (e.sinks().forEach(o), Object.keys(n).length !== e.nodeCount())
    throw new D;
  return r;
}
function Cn(e) {
  try {
    ke(e);
  } catch (n) {
    if (n instanceof D)
      return false;
    throw n;
  }
  return true;
}
function Rn(e, n, t, r, o) {
  Array.isArray(n) || (n = [n]);
  let i = (a) => {
    var d;
    return (d = e.isDirected() ? e.successors(a) : e.neighbors(a)) != null ? d : [];
  }, s = {};
  return n.forEach(function(a) {
    if (!e.hasNode(a))
      throw new Error("Graph does not have node: " + a);
    o = ve(e, a, t === "post", s, i, r, o);
  }), o;
}
function ve(e, n, t, r, o, i, s) {
  return n in r || (r[n] = true, t || (s = i(s, n)), o(n).forEach(function(a) {
    s = ve(e, a, t, r, o, i, s);
  }), t && (s = i(s, n))), s;
}
function _e(e, n, t) {
  return Rn(e, n, t, function(r, o) {
    return r.push(o), r;
  }, []);
}
function Pn(e, n) {
  return _e(e, n, "post");
}
function Mn(e, n) {
  return _e(e, n, "pre");
}
function jn(e, n) {
  let t = new p, r = {}, o = new Ne, i;
  function s(d) {
    let l = d.v === i ? d.w : d.v, u = o.priority(l);
    if (u !== undefined) {
      let c = n(d);
      c < u && (r[l] = i, o.decrease(l, c));
    }
  }
  if (e.nodeCount() === 0)
    return t;
  e.nodes().forEach(function(d) {
    o.add(d, Number.POSITIVE_INFINITY), t.setNode(d);
  }), o.decrease(e.nodes()[0], 0);
  let a = false;
  for (;o.size() > 0; ) {
    if (i = o.removeMin(), i in r)
      t.setEdge(i, r[i]);
    else {
      if (a)
        throw new Error("Input graph is not connected: " + e);
      a = true;
    }
    e.nodeEdges(i).forEach(s);
  }
  return t;
}
function Sn(e, n, t, r) {
  return Fn(e, n, t, r != null ? r : (o) => {
    let i = e.outEdges(o);
    return i != null ? i : [];
  });
}
function Fn(e, n, t, r) {
  if (t === undefined)
    return F(e, n, t, r);
  let o = false, i = e.nodes();
  for (let s = 0;s < i.length; s++) {
    let a = r(i[s]);
    for (let d = 0;d < a.length; d++) {
      let l = a[d], u = l.v === i[s] ? l.v : l.w, c = u === l.v ? l.w : l.v;
      t({ v: u, w: c }) < 0 && (o = true);
    }
    if (o)
      return we(e, n, t, r);
  }
  return F(e, n, t, r);
}
function w(e, n, t, r) {
  let o = r;
  for (;e.hasNode(o); )
    o = j(r);
  return t.dummy = n, e.setNode(o, t), o;
}
function xe(e) {
  let n = new p().setGraph(e.graph());
  return e.nodes().forEach((t) => n.setNode(t, e.node(t))), e.edges().forEach((t) => {
    let r = n.edge(t.v, t.w) || { weight: 0, minlen: 1 }, o = e.edge(t);
    n.setEdge(t.v, t.w, { weight: r.weight + o.weight, minlen: Math.max(r.minlen, o.minlen) });
  }), n;
}
function A(e) {
  let n = new p({ multigraph: e.isMultigraph() }).setGraph(e.graph());
  return e.nodes().forEach((t) => {
    e.children(t).length || n.setNode(t, e.node(t));
  }), e.edges().forEach((t) => {
    n.setEdge(t, e.edge(t));
  }), n;
}
function H(e, n) {
  let { x: t, y: r } = e, o = n.x - t, i = n.y - r, s = e.width / 2, a = e.height / 2;
  if (!o && !i)
    throw new Error("Not possible to find intersection inside of the rectangle");
  let d, l;
  return Math.abs(i) * s > Math.abs(o) * a ? (i < 0 && (a = -a), d = a * o / i, l = a) : (o < 0 && (s = -s), d = s, l = s * i / o), { x: t + d, y: r + l };
}
function N(e) {
  let n = k(X(e) + 1).map(() => []);
  return e.nodes().forEach((t) => {
    let r = e.node(t), o = r.rank;
    o !== undefined && (n[o] || (n[o] = []), n[o][r.order] = t);
  }), n;
}
function Te(e) {
  let n = e.nodes().map((r) => {
    let o = e.node(r).rank;
    return o === undefined ? Number.MAX_VALUE : o;
  }), t = L(Math.min, n);
  e.nodes().forEach((r) => {
    let o = e.node(r);
    Object.hasOwn(o, "rank") && (o.rank -= t);
  });
}
function Oe(e) {
  let n = e.nodes().map((s) => e.node(s).rank).filter((s) => s !== undefined), t = L(Math.min, n), r = [];
  e.nodes().forEach((s) => {
    let a = e.node(s).rank - t;
    r[a] || (r[a] = []), r[a].push(s);
  });
  let o = 0, i = e.graph().nodeRankFactor;
  Array.from(r).forEach((s, a) => {
    s === undefined && a % i !== 0 ? --o : s !== undefined && o && s.forEach((d) => e.node(d).rank += o);
  });
}
function q(e, n, t, r) {
  let o = { width: 0, height: 0 };
  return arguments.length >= 4 && (o.rank = t, o.order = r), w(e, "border", o, n);
}
function Dn(e, n = Ie) {
  let t = [];
  for (let r = 0;r < e.length; r += n) {
    let o = e.slice(r, r + n);
    t.push(o);
  }
  return t;
}
var Ie = 65535;
function L(e, n) {
  if (n.length > Ie) {
    let t = Dn(n);
    return e(...t.map((r) => e(...r)));
  } else
    return e(...n);
}
function X(e) {
  let t = e.nodes().map((r) => {
    let o = e.node(r).rank;
    return o === undefined ? Number.MIN_VALUE : o;
  });
  return L(Math.max, t);
}
function Ce(e, n) {
  let t = { lhs: [], rhs: [] };
  return e.forEach((r) => {
    n(r) ? t.lhs.push(r) : t.rhs.push(r);
  }), t;
}
function P(e, n) {
  let t = Date.now();
  try {
    return n();
  } finally {
    console.log(e + " time: " + (Date.now() - t) + "ms");
  }
}
function M(e, n) {
  return n();
}
var An = 0;
function j(e) {
  let n = ++An;
  return e + ("" + n);
}
function k(e, n, t = 1) {
  n == null && (n = e, e = 0);
  let r = (i) => i < n;
  t < 0 && (r = (i) => n < i);
  let o = [];
  for (let i = e;r(i); i += t)
    o.push(i);
  return o;
}
function T(e, n) {
  let t = {};
  for (let r of n)
    e[r] !== undefined && (t[r] = e[r]);
  return t;
}
function O(e, n) {
  let t;
  return typeof n == "string" ? t = (r) => r[n] : t = n, Object.entries(e).reduce((r, [o, i]) => (r[o] = t(i, o), r), {});
}
function Re(e, n) {
  return e.reduce((t, r, o) => (t[r] = n[o], t), {});
}
var _ = "\x00";
var U = "3.0.0";
var K = class {
  constructor() {
    pe(this, "_sentinel");
    let n = {};
    n._next = n._prev = n, this._sentinel = n;
  }
  dequeue() {
    let n = this._sentinel, t = n._prev;
    if (t !== n)
      return Pe(t), t;
  }
  enqueue(n) {
    let t = this._sentinel;
    n._prev && n._next && Pe(n), n._next = t._next, t._next._prev = n, t._next = n, n._prev = t;
  }
  toString() {
    let n = [], t = this._sentinel, r = t._prev;
    for (;r !== t; )
      n.push(JSON.stringify(r, Vn)), r = r._prev;
    return "[" + n.join(", ") + "]";
  }
};
function Pe(e) {
  e._prev._next = e._next, e._next._prev = e._prev, delete e._next, delete e._prev;
}
function Vn(e, n) {
  if (e !== "_next" && e !== "_prev")
    return n;
}
var Me = K;
var Wn = () => 1;
function Q(e, n) {
  if (e.nodeCount() <= 1)
    return [];
  let t = Yn(e, n || Wn);
  return Bn(t.graph, t.buckets, t.zeroIdx).flatMap((o) => e.outEdges(o.v, o.w) || []);
}
function Bn(e, n, t) {
  var a;
  let r = [], o = n[n.length - 1], i = n[0], s;
  for (;e.nodeCount(); ) {
    for (;s = i.dequeue(); )
      $(e, n, t, s);
    for (;s = o.dequeue(); )
      $(e, n, t, s);
    if (e.nodeCount()) {
      for (let d = n.length - 2;d > 0; --d)
        if (s = (a = n[d]) == null ? undefined : a.dequeue(), s) {
          r = r.concat($(e, n, t, s, true) || []);
          break;
        }
    }
  }
  return r;
}
function $(e, n, t, r, o) {
  let i = [], s = o ? i : undefined;
  return (e.inEdges(r.v) || []).forEach((a) => {
    let d = e.edge(a), l = e.node(a.v);
    o && i.push({ v: a.v, w: a.w }), l.out -= d, J(n, t, l);
  }), (e.outEdges(r.v) || []).forEach((a) => {
    let d = e.edge(a), l = a.w, u = e.node(l);
    u.in -= d, J(n, t, u);
  }), e.removeNode(r.v), s;
}
function Yn(e, n) {
  let t = new p, r = 0, o = 0;
  e.nodes().forEach((a) => {
    t.setNode(a, { v: a, in: 0, out: 0 });
  }), e.edges().forEach((a) => {
    let d = t.edge(a.v, a.w) || 0, l = n(a), u = d + l;
    t.setEdge(a.v, a.w, u);
    let c = t.node(a.v), h = t.node(a.w);
    o = Math.max(o, c.out += l), r = Math.max(r, h.in += l);
  });
  let i = zn(o + r + 3).map(() => new Me), s = r + 1;
  return t.nodes().forEach((a) => {
    J(i, s, t.node(a));
  }), { graph: t, buckets: i, zeroIdx: s };
}
function J(e, n, t) {
  var r, o, i;
  t.out ? t.in ? (i = e[t.out - t.in + n]) == null || i.enqueue(t) : (o = e[e.length - 1]) == null || o.enqueue(t) : (r = e[0]) == null || r.enqueue(t);
}
function zn(e) {
  let n = [];
  for (let t = 0;t < e; t++)
    n.push(t);
  return n;
}
function je(e) {
  (e.graph().acyclicer === "greedy" ? Q(e, t(e)) : Hn(e)).forEach((r) => {
    let o = e.edge(r);
    e.removeEdge(r), o.forwardName = r.name, o.reversed = true, e.setEdge(r.w, r.v, o, j("rev"));
  });
  function t(r) {
    return (o) => r.edge(o).weight;
  }
}
function Hn(e) {
  let n = [], t = {}, r = {};
  function o(i) {
    Object.hasOwn(r, i) || (r[i] = true, t[i] = true, e.outEdges(i).forEach((s) => {
      Object.hasOwn(t, s.w) ? n.push(s) : o(s.w);
    }), delete t[i]);
  }
  return e.nodes().forEach(o), n;
}
function Se(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (t.reversed) {
      e.removeEdge(n);
      let r = t.forwardName;
      delete t.reversed, delete t.forwardName, e.setEdge(n.w, n.v, t, r);
    }
  });
}
function Fe(e) {
  e.graph().dummyChains = [], e.edges().forEach((n) => Xn(e, n));
}
function Xn(e, n) {
  let t = n.v, r = e.node(t).rank, o = n.w, i = e.node(o).rank, s = n.name, a = e.edge(n), d = a.labelRank;
  if (i === r + 1)
    return;
  e.removeEdge(n);
  let l, u, c;
  for (c = 0, ++r;r < i; ++c, ++r)
    a.points = [], u = { width: 0, height: 0, edgeLabel: a, edgeObj: n, rank: r }, l = w(e, "edge", u, "_d"), r === d && (u.width = a.width, u.height = a.height, u.dummy = "edge-label", u.labelpos = a.labelpos), e.setEdge(t, l, { weight: a.weight }, s), c === 0 && e.graph().dummyChains.push(l), t = l;
  e.setEdge(t, o, { weight: a.weight }, s);
}
function De(e) {
  e.graph().dummyChains.forEach((n) => {
    let t = e.node(n), r = t.edgeLabel, o;
    for (e.setEdge(t.edgeObj, r);t.dummy; )
      o = e.successors(n)[0], e.removeNode(n), r.points.push({ x: t.x, y: t.y }), t.dummy === "edge-label" && (r.x = t.x, r.y = t.y, r.width = t.width, r.height = t.height), n = o, t = e.node(n);
  });
}
function S(e) {
  let n = {};
  function t(r) {
    let o = e.node(r);
    if (Object.hasOwn(n, r))
      return o.rank;
    n[r] = true;
    let i = e.outEdges(r), s = i ? i.map((d) => d == null ? Number.POSITIVE_INFINITY : t(d.w) - e.edge(d).minlen) : [], a = L(Math.min, s);
    return a === Number.POSITIVE_INFINITY && (a = 0), o.rank = a;
  }
  e.sources().forEach(t);
}
function v(e, n) {
  return e.node(n.w).rank - e.node(n.v).rank - e.edge(n).minlen;
}
var V = Kn;
function Kn(e) {
  let n = new p({ directed: false }), t = e.nodes();
  if (t.length === 0)
    throw new Error("Graph must have at least one node");
  let r = t[0], o = e.nodeCount();
  n.setNode(r, {});
  let i, s;
  for (;$n(n, e) < o && (i = Jn(n, e), !!i); )
    s = n.hasNode(i.v) ? v(e, i) : -v(e, i), Qn(n, e, s);
  return n;
}
function $n(e, n) {
  function t(r) {
    let o = n.nodeEdges(r);
    o && o.forEach((i) => {
      let s = i.v, a = r === s ? i.w : s;
      !e.hasNode(a) && !v(n, i) && (e.setNode(a, {}), e.setEdge(r, a, {}), t(a));
    });
  }
  return e.nodes().forEach(t), e.nodeCount();
}
function Jn(e, n) {
  return n.edges().reduce((r, o) => {
    let i = Number.POSITIVE_INFINITY;
    return e.hasNode(o.v) !== e.hasNode(o.w) && (i = v(n, o)), i < r[0] ? [i, o] : r;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function Qn(e, n, t) {
  e.nodes().forEach((r) => n.node(r).rank += t);
}
var { preorder: Zn, postorder: et } = R;
var Ve = x;
x.initLowLimValues = ee;
x.initCutValues = Z;
x.calcCutValue = We;
x.leaveEdge = Ye;
x.enterEdge = ze;
x.exchangeEdges = He;
function x(e) {
  e = xe(e), S(e);
  let n = V(e);
  ee(n), Z(n, e);
  let t, r;
  for (;t = Ye(n); )
    r = ze(n, e, t), He(n, e, t, r);
}
function Z(e, n) {
  let t = et(e, e.nodes());
  t = t.slice(0, t.length - 1), t.forEach((r) => nt(e, n, r));
}
function nt(e, n, t) {
  let o = e.node(t).parent, i = e.edge(t, o);
  i.cutvalue = We(e, n, t);
}
function We(e, n, t) {
  let o = e.node(t).parent, i = true, s = n.edge(t, o), a = 0;
  s || (i = false, s = n.edge(o, t)), a = s.weight;
  let d = n.nodeEdges(t);
  return d && d.forEach((l) => {
    let u = l.v === t, c = u ? l.w : l.v;
    if (c !== o) {
      let h = u === i, f = n.edge(l).weight;
      if (a += h ? f : -f, rt(e, t, c)) {
        let b = e.edge(t, c).cutvalue;
        a += h ? -b : b;
      }
    }
  }), a;
}
function ee(e, n) {
  arguments.length < 2 && (n = e.nodes()[0]), Be(e, {}, 1, n);
}
function Be(e, n, t, r, o) {
  let i = t, s = e.node(r);
  n[r] = true;
  let a = e.neighbors(r);
  return a && a.forEach((d) => {
    Object.hasOwn(n, d) || (t = Be(e, n, t, d, r));
  }), s.low = i, s.lim = t++, o ? s.parent = o : delete s.parent, t;
}
function Ye(e) {
  return e.edges().find((n) => e.edge(n).cutvalue < 0);
}
function ze(e, n, t) {
  let { v: r, w: o } = t;
  n.hasEdge(r, o) || (r = t.w, o = t.v);
  let i = e.node(r), s = e.node(o), a = i, d = false;
  return i.lim > s.lim && (a = s, d = true), n.edges().filter((u) => d === Ae(e, e.node(u.v), a) && d !== Ae(e, e.node(u.w), a)).reduce((u, c) => v(n, c) < v(n, u) ? c : u);
}
function He(e, n, t, r) {
  let { v: o, w: i } = t;
  e.removeEdge(o, i), e.setEdge(r.v, r.w, {}), ee(e), Z(e, n), tt(e, n);
}
function tt(e, n) {
  let t = e.nodes().find((o) => !e.node(o).parent);
  if (!t)
    return;
  let r = Zn(e, [t]);
  r = r.slice(1), r.forEach((o) => {
    let s = e.node(o).parent, a = n.edge(o, s), d = false;
    a || (a = n.edge(s, o), d = true), n.node(o).rank = n.node(s).rank + (d ? a.minlen : -a.minlen);
  });
}
function rt(e, n, t) {
  return e.hasEdge(n, t);
}
function Ae(e, n, t) {
  return t.low <= n.lim && n.lim <= t.lim;
}
var Xe = ot;
function ot(e) {
  let n = e.graph().ranker;
  if (typeof n == "function")
    return n(e);
  switch (n) {
    case "network-simplex":
      qe(e);
      break;
    case "tight-tree":
      st(e);
      break;
    case "longest-path":
      it(e);
      break;
    case "none":
      break;
    default:
      qe(e);
  }
}
var it = S;
function st(e) {
  S(e), V(e);
}
function qe(e) {
  Ve(e);
}
var Ue = at;
function at(e) {
  let n = lt(e);
  e.graph().dummyChains.forEach((t) => {
    let r = e.node(t), o = r.edgeObj, i = dt(e, n, o.v, o.w), s = i.path, a = i.lca, d = 0, l = s[d], u = true;
    for (;t !== o.w; ) {
      if (r = e.node(t), u) {
        for (;(l = s[d]) !== a && e.node(l).maxRank < r.rank; )
          d++;
        l === a && (u = false);
      }
      if (!u) {
        for (;d < s.length - 1 && e.node(s[d + 1]).minRank <= r.rank; )
          d++;
        l = s[d];
      }
      l !== undefined && e.setParent(t, l), t = e.successors(t)[0];
    }
  });
}
function dt(e, n, t, r) {
  let o = [], i = [], s = Math.min(n[t].low, n[r].low), a = Math.max(n[t].lim, n[r].lim), d;
  d = t;
  do
    d = e.parent(d), o.push(d);
  while (d && (n[d].low > s || a > n[d].lim));
  let l = d, u = r;
  for (;(u = e.parent(u)) !== l; )
    i.push(u);
  return { path: o.concat(i.reverse()), lca: l };
}
function lt(e) {
  let n = {}, t = 0;
  function r(o) {
    let i = t;
    e.children(o).forEach(r), n[o] = { low: i, lim: t++ };
  }
  return e.children(_).forEach(r), n;
}
function Ke(e) {
  let n = w(e, "root", {}, "_root"), t = ut(e), r = Object.values(t), o = L(Math.max, r) - 1, i = 2 * o + 1;
  e.graph().nestingRoot = n, e.edges().forEach((a) => e.edge(a).minlen *= i);
  let s = ct(e) + 1;
  e.children(_).forEach((a) => $e(e, n, i, s, o, t, a)), e.graph().nodeRankFactor = i;
}
function $e(e, n, t, r, o, i, s) {
  var c;
  let a = e.children(s);
  if (!a.length) {
    s !== n && e.setEdge(n, s, { weight: 0, minlen: t });
    return;
  }
  let d = q(e, "_bt"), l = q(e, "_bb"), u = e.node(s);
  e.setParent(d, s), u.borderTop = d, e.setParent(l, s), u.borderBottom = l, a.forEach((h) => {
    var y;
    $e(e, n, t, r, o, i, h);
    let f = e.node(h), g = f.borderTop ? f.borderTop : h, b = f.borderBottom ? f.borderBottom : h, m = f.borderTop ? r : 2 * r, E = g !== b ? 1 : o - ((y = i[s]) != null ? y : 0) + 1;
    e.setEdge(d, g, { weight: m, minlen: E, nestingEdge: true }), e.setEdge(b, l, { weight: m, minlen: E, nestingEdge: true });
  }), e.parent(s) || e.setEdge(n, d, { weight: 0, minlen: o + ((c = i[s]) != null ? c : 0) });
}
function ut(e) {
  let n = {};
  function t(r, o) {
    let i = e.children(r);
    i && i.length && i.forEach((s) => t(s, o + 1)), n[r] = o;
  }
  return e.children(_).forEach((r) => t(r, 1)), n;
}
function ct(e) {
  return e.edges().reduce((n, t) => n + e.edge(t).weight, 0);
}
function Je(e) {
  let n = e.graph();
  e.removeNode(n.nestingRoot), delete n.nestingRoot, e.edges().forEach((t) => {
    e.edge(t).nestingEdge && e.removeEdge(t);
  });
}
var Ze = ft;
function ft(e) {
  function n(t) {
    let r = e.children(t), o = e.node(t);
    if (r.length && r.forEach(n), Object.hasOwn(o, "minRank")) {
      o.borderLeft = [], o.borderRight = [];
      for (let i = o.minRank, s = o.maxRank + 1;i < s; ++i)
        Qe(e, "borderLeft", "_bl", t, o, i), Qe(e, "borderRight", "_br", t, o, i);
    }
  }
  e.children(_).forEach(n);
}
function Qe(e, n, t, r, o, i) {
  let s = { width: 0, height: 0, rank: i, borderType: n }, a = o[n][i - 1], d = w(e, "border", s, t);
  o[n][i] = d, e.setParent(d, r), a && e.setEdge(a, d, { weight: 1 });
}
function nn(e) {
  var t;
  let n = (t = e.graph().rankdir) == null ? undefined : t.toLowerCase();
  (n === "lr" || n === "rl") && rn(e);
}
function tn(e) {
  var t;
  let n = (t = e.graph().rankdir) == null ? undefined : t.toLowerCase();
  (n === "bt" || n === "rl") && bt(e), (n === "lr" || n === "rl") && (gt(e), rn(e));
}
function rn(e) {
  e.nodes().forEach((n) => en(e.node(n))), e.edges().forEach((n) => en(e.edge(n)));
}
function en(e) {
  let n = e.width;
  e.width = e.height, e.height = n;
}
function bt(e) {
  e.nodes().forEach((n) => ne(e.node(n))), e.edges().forEach((n) => {
    var r;
    let t = e.edge(n);
    (r = t.points) == null || r.forEach(ne), Object.hasOwn(t, "y") && ne(t);
  });
}
function ne(e) {
  e.y = -e.y;
}
function gt(e) {
  e.nodes().forEach((n) => te(e.node(n))), e.edges().forEach((n) => {
    var r;
    let t = e.edge(n);
    (r = t.points) == null || r.forEach(te), Object.hasOwn(t, "x") && te(t);
  });
}
function te(e) {
  let n = e.x;
  e.x = e.y, e.y = n;
}
function re(e) {
  let n = {}, t = e.nodes().filter((d) => !e.children(d).length), r = t.map((d) => e.node(d).rank), o = L(Math.max, r), i = k(o + 1).map(() => []);
  function s(d) {
    if (n[d])
      return;
    n[d] = true;
    let l = e.node(d);
    i[l.rank].push(d);
    let u = e.successors(d);
    u && u.forEach(s);
  }
  return t.sort((d, l) => e.node(d).rank - e.node(l).rank).forEach(s), i;
}
function oe(e, n) {
  let t = 0;
  for (let r = 1;r < n.length; ++r)
    t += mt(e, n[r - 1], n[r]);
  return t;
}
function mt(e, n, t) {
  let r = Re(t, t.map((l, u) => u)), o = n.flatMap((l) => {
    let u = e.outEdges(l);
    return u ? u.map((c) => ({ pos: r[c.w], weight: e.edge(c).weight })).sort((c, h) => c.pos - h.pos) : [];
  }), i = 1;
  for (;i < t.length; )
    i <<= 1;
  let s = 2 * i - 1;
  i -= 1;
  let a = new Array(s).fill(0), d = 0;
  return o.forEach((l) => {
    let u = l.pos + i;
    a[u] += l.weight;
    let c = 0;
    for (;u > 0; )
      u % 2 && (c += a[u + 1]), u = u - 1 >> 1, a[u] += l.weight;
    d += l.weight * c;
  }), d;
}
function ie(e, n = []) {
  return n.map((t) => {
    let r = e.inEdges(t);
    if (!r || !r.length)
      return { v: t };
    {
      let o = r.reduce((i, s) => {
        let a = e.edge(s), d = e.node(s.v);
        return { sum: i.sum + a.weight * d.order, weight: i.weight + a.weight };
      }, { sum: 0, weight: 0 });
      return { v: t, barycenter: o.sum / o.weight, weight: o.weight };
    }
  });
}
function se(e, n) {
  let t = {};
  e.forEach((o, i) => {
    let s = { indegree: 0, in: [], out: [], vs: [o.v], i };
    o.barycenter !== undefined && (s.barycenter = o.barycenter, s.weight = o.weight), t[o.v] = s;
  }), n.edges().forEach((o) => {
    let i = t[o.v], s = t[o.w];
    i !== undefined && s !== undefined && (s.indegree++, i.out.push(s));
  });
  let r = Object.values(t).filter((o) => !o.indegree);
  return Et(r);
}
function Et(e) {
  let n = [];
  function t(o) {
    return (i) => {
      i.merged || (i.barycenter === undefined || o.barycenter === undefined || i.barycenter >= o.barycenter) && Lt(o, i);
    };
  }
  function r(o) {
    return (i) => {
      i.in.push(o), --i.indegree === 0 && e.push(i);
    };
  }
  for (;e.length; ) {
    let o = e.pop();
    n.push(o), o.in.reverse().forEach(t(o)), o.out.forEach(r(o));
  }
  return n.filter((o) => !o.merged).map((o) => T(o, ["vs", "i", "barycenter", "weight"]));
}
function Lt(e, n) {
  let t = 0, r = 0;
  e.weight && (t += e.barycenter * e.weight, r += e.weight), n.weight && (t += n.barycenter * n.weight, r += n.weight), e.vs = n.vs.concat(e.vs), e.barycenter = t / r, e.weight = r, e.i = Math.min(n.i, e.i), n.merged = true;
}
function ae(e, n) {
  let t = Ce(e, (u) => Object.hasOwn(u, "barycenter")), r = t.lhs, o = t.rhs.sort((u, c) => c.i - u.i), i = [], s = 0, a = 0, d = 0;
  r.sort(yt(!!n)), d = on(i, o, d), r.forEach((u) => {
    d += u.vs.length, i.push(u.vs), s += u.barycenter * u.weight, a += u.weight, d = on(i, o, d);
  });
  let l = { vs: i.flat(1) };
  return a && (l.barycenter = s / a, l.weight = a), l;
}
function on(e, n, t) {
  let r;
  for (;n.length && (r = n[n.length - 1]).i <= t; )
    n.pop(), e.push(r.vs), t++;
  return t;
}
function yt(e) {
  return (n, t) => n.barycenter < t.barycenter ? -1 : n.barycenter > t.barycenter ? 1 : e ? t.i - n.i : n.i - t.i;
}
function W(e, n, t, r) {
  let o = e.children(n), i = e.node(n), s = i ? i.borderLeft : undefined, a = i ? i.borderRight : undefined, d = {};
  s && (o = o.filter((h) => h !== s && h !== a));
  let l = ie(e, o);
  l.forEach((h) => {
    if (e.children(h.v).length) {
      let f = W(e, h.v, t, r);
      d[h.v] = f, Object.hasOwn(f, "barycenter") && Nt(h, f);
    }
  });
  let u = se(l, t);
  wt(u, d);
  let c = ae(u, r);
  if (s && a) {
    c.vs = [s, c.vs, a].flat(1);
    let h = e.predecessors(s);
    if (h && h.length) {
      let f = e.node(h[0]), g = e.predecessors(a), b = e.node(g[0]);
      Object.hasOwn(c, "barycenter") || (c.barycenter = 0, c.weight = 0), c.barycenter = (c.barycenter * c.weight + f.order + b.order) / (c.weight + 2), c.weight += 2;
    }
  }
  return c;
}
function wt(e, n) {
  e.forEach((t) => {
    t.vs = t.vs.flatMap((r) => n[r] ? n[r].vs : r);
  });
}
function Nt(e, n) {
  e.barycenter !== undefined ? (e.barycenter = (e.barycenter * e.weight + n.barycenter * n.weight) / (e.weight + n.weight), e.weight += n.weight) : (e.barycenter = n.barycenter, e.weight = n.weight);
}
function de(e, n, t, r) {
  r || (r = e.nodes());
  let o = Gt(e), i = new p({ compound: true }).setGraph({ root: o }).setDefaultNodeLabel((s) => e.node(s));
  return r.forEach((s) => {
    let a = e.node(s), d = e.parent(s);
    if (a.rank === n || a.minRank <= n && n <= a.maxRank) {
      i.setNode(s), i.setParent(s, d || o);
      let l = e[t](s);
      l && l.forEach((u) => {
        let c = u.v === s ? u.w : u.v, h = i.edge(c, s), f = h !== undefined ? h.weight : 0;
        i.setEdge(c, s, { weight: e.edge(u).weight + f });
      }), Object.hasOwn(a, "minRank") && i.setNode(s, { borderLeft: a.borderLeft[n], borderRight: a.borderRight[n] });
    }
  }), i;
}
function Gt(e) {
  let n;
  for (;e.hasNode(n = j("_root")); )
    ;
  return n;
}
function le(e, n, t) {
  let r = {}, o;
  t.forEach((i) => {
    let s = e.parent(i), a, d;
    for (;s; ) {
      if (a = e.parent(s), a ? (d = r[a], r[a] = s) : (d = o, o = s), d && d !== s) {
        n.setEdge(d, s);
        return;
      }
      s = a;
    }
  });
}
function B(e, n = {}) {
  if (typeof n.customOrder == "function") {
    n.customOrder(e, B);
    return;
  }
  let t = X(e), r = sn(e, k(1, t + 1), "inEdges"), o = sn(e, k(t - 1, -1, -1), "outEdges"), i = re(e);
  if (an(e, i), n.disableOptimalOrderHeuristic)
    return;
  let s = Number.POSITIVE_INFINITY, a, d = n.constraints || [];
  for (let l = 0, u = 0;u < 4; ++l, ++u) {
    kt(l % 2 ? r : o, l % 4 >= 2, d), i = N(e);
    let c = oe(e, i);
    c < s ? (u = 0, a = Object.assign({}, i), s = c) : c === s && (a = structuredClone(i));
  }
  an(e, a);
}
function sn(e, n, t) {
  let r = new Map, o = (i, s) => {
    r.has(i) || r.set(i, []), r.get(i).push(s);
  };
  for (let i of e.nodes()) {
    let s = e.node(i);
    if (typeof s.rank == "number" && o(s.rank, i), typeof s.minRank == "number" && typeof s.maxRank == "number")
      for (let a = s.minRank;a <= s.maxRank; a++)
        a !== s.rank && o(a, i);
  }
  return n.map(function(i) {
    return de(e, i, t, r.get(i) || []);
  });
}
function kt(e, n, t) {
  let r = new p;
  e.forEach(function(o) {
    t.forEach((a) => r.setEdge(a.left, a.right));
    let i = o.graph().root, s = W(o, i, r, n);
    s.vs.forEach((a, d) => o.node(a).order = d), le(o, r, s.vs);
  });
}
function an(e, n) {
  Object.values(n).forEach((t) => t.forEach((r, o) => e.node(r).order = o));
}
function vt(e, n) {
  let t = {};
  function r(o, i) {
    let s = 0, a = 0, d = o.length, l = i[i.length - 1];
    return i.forEach((u, c) => {
      let h = xt(e, u), f = h ? e.node(h).order : d;
      (h || u === l) && (i.slice(a, c + 1).forEach((g) => {
        let b = e.predecessors(g);
        b && b.forEach((m) => {
          let E = e.node(m), y = E.order;
          (y < s || f < y) && !(E.dummy && e.node(g).dummy) && dn(t, m, g);
        });
      }), a = c + 1, s = f);
    }), i;
  }
  return n.length && n.reduce(r), t;
}
function _t(e, n) {
  let t = {};
  function r(i, s, a, d, l) {
    k(s, a).forEach((u) => {
      let c = i[u];
      if (c !== undefined && e.node(c).dummy) {
        let h = e.predecessors(c);
        h && h.forEach((f) => {
          if (f === undefined)
            return;
          let g = e.node(f);
          g.dummy && (g.order < d || g.order > l) && dn(t, f, c);
        });
      }
    });
  }
  function o(i, s) {
    let a = -1, d = -1, l = 0;
    return s.forEach((u, c) => {
      if (e.node(u).dummy === "border") {
        let h = e.predecessors(u);
        if (h && h.length) {
          let f = h[0];
          if (f === undefined)
            return;
          d = e.node(f).order, r(s, l, c, a, d), l = c, a = d;
        }
      }
      r(s, l, s.length, d, i.length);
    }), s;
  }
  return n.length && n.reduce(o), t;
}
function xt(e, n) {
  if (e.node(n).dummy) {
    let t = e.predecessors(n);
    if (t)
      return t.find((r) => e.node(r).dummy);
  }
}
function dn(e, n, t) {
  if (n > t) {
    let o = n;
    n = t, t = o;
  }
  let r = e[n];
  r || (e[n] = r = {}), r[t] = true;
}
function Tt(e, n, t) {
  if (n > t) {
    let o = n;
    n = t, t = o;
  }
  let r = e[n];
  return r !== undefined && Object.hasOwn(r, t);
}
function Ot(e, n, t, r) {
  let o = {}, i = {}, s = {};
  return n.forEach((a) => {
    a.forEach((d, l) => {
      o[d] = d, i[d] = d, s[d] = l;
    });
  }), n.forEach((a) => {
    let d = -1;
    a.forEach((l) => {
      let u = r(l);
      if (u && u.length) {
        let c = u.sort((f, g) => {
          let b = s[f], m = s[g];
          return (b !== undefined ? b : 0) - (m !== undefined ? m : 0);
        }), h = (c.length - 1) / 2;
        for (let f = Math.floor(h), g = Math.ceil(h);f <= g; ++f) {
          let b = c[f];
          if (b === undefined)
            continue;
          let m = s[b];
          if (m !== undefined && i[l] === l && d < m && !Tt(t, l, b)) {
            let E = o[b];
            E !== undefined && (i[b] = l, i[l] = o[l] = E, d = m);
          }
        }
      }
    });
  }), { root: o, align: i };
}
function It(e, n, t, r, o = false) {
  let i = {}, s = Ct(e, n, t, o), a = o ? "borderLeft" : "borderRight";
  function d(f, g) {
    let b = s.nodes().slice(), m = {}, E = b.pop();
    for (;E; ) {
      if (m[E])
        f(E);
      else {
        m[E] = true, b.push(E);
        for (let y of g(E))
          b.push(y);
      }
      E = b.pop();
    }
  }
  function l(f) {
    let g = s.inEdges(f);
    g ? i[f] = g.reduce((b, m) => {
      var I;
      let E = (I = i[m.v]) != null ? I : 0, y = s.edge(m);
      return Math.max(b, E + (y !== undefined ? y : 0));
    }, 0) : i[f] = 0;
  }
  function u(f) {
    let g = s.outEdges(f), b = Number.POSITIVE_INFINITY;
    g && (b = g.reduce((E, y) => {
      let I = i[y.w], be = s.edge(y);
      return Math.min(E, (I !== undefined ? I : 0) - (be !== undefined ? be : 0));
    }, Number.POSITIVE_INFINITY));
    let m = e.node(f);
    b !== Number.POSITIVE_INFINITY && m.borderType !== a && (i[f] = Math.max(i[f] !== undefined ? i[f] : 0, b));
  }
  function c(f) {
    return s.predecessors(f) || [];
  }
  function h(f) {
    return s.successors(f) || [];
  }
  return d(l, c), d(u, h), Object.keys(r).forEach((f) => {
    var b;
    let g = t[f];
    g !== undefined && (i[f] = (b = i[g]) != null ? b : 0);
  }), i;
}
function Ct(e, n, t, r) {
  let o = new p, i = e.graph(), s = jt(i.nodesep, i.edgesep, r);
  return n.forEach((a) => {
    let d;
    a.forEach((l) => {
      let u = t[l];
      if (u !== undefined) {
        if (o.setNode(u), d !== undefined) {
          let c = t[d];
          if (c !== undefined) {
            let h = o.edge(c, u);
            o.setEdge(c, u, Math.max(s(e, l, d), h || 0));
          }
        }
        d = l;
      }
    });
  }), o;
}
function Rt(e, n) {
  return Object.values(n).reduce((t, r) => {
    let { NEGATIVE_INFINITY: o, POSITIVE_INFINITY: i } = Number;
    Object.entries(r).forEach(([a, d]) => {
      let l = St(e, a) / 2;
      o = Math.max(d + l, o), i = Math.min(d - l, i);
    });
    let s = o - i;
    return s < t[0] && (t = [s, r]), t;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function Pt(e, n) {
  let t = Object.values(n), r = L(Math.min, t), o = L(Math.max, t);
  ["u", "d"].forEach((i) => {
    ["l", "r"].forEach((s) => {
      let a = i + s, d = e[a];
      if (!d || d === n)
        return;
      let l = Object.values(d), u = r - L(Math.min, l);
      s !== "l" && (u = o - L(Math.max, l)), u && (e[a] = O(d, (c) => c + u));
    });
  });
}
function Mt(e, n = undefined) {
  let t = e.ul;
  return t ? O(t, (r, o) => {
    var s, a;
    if (n) {
      let d = n.toLowerCase(), l = e[d];
      if (l && l[o] !== undefined)
        return l[o];
    }
    let i = Object.values(e).map((d) => {
      let l = d[o];
      return l !== undefined ? l : 0;
    }).sort((d, l) => d - l);
    return (((s = i[1]) != null ? s : 0) + ((a = i[2]) != null ? a : 0)) / 2;
  }) : {};
}
function ln(e) {
  let n = N(e), t = Object.assign(vt(e, n), _t(e, n)), r = {}, o;
  ["u", "d"].forEach((s) => {
    o = s === "u" ? n : Object.values(n).reverse(), ["l", "r"].forEach((a) => {
      a === "r" && (o = o.map((c) => Object.values(c).reverse()));
      let l = Ot(e, o, t, (c) => (s === "u" ? e.predecessors(c) : e.successors(c)) || []), u = It(e, o, l.root, l.align, a === "r");
      a === "r" && (u = O(u, (c) => -c)), r[s + a] = u;
    });
  });
  let i = Rt(e, r);
  return Pt(r, i), Mt(r, e.graph().align);
}
function jt(e, n, t) {
  return (r, o, i) => {
    let s = r.node(o), a = r.node(i), d = 0, l;
    if (d += s.width / 2, Object.hasOwn(s, "labelpos"))
      switch (s.labelpos.toLowerCase()) {
        case "l":
          l = -s.width / 2;
          break;
        case "r":
          l = s.width / 2;
          break;
      }
    if (l && (d += t ? l : -l), l = undefined, d += (s.dummy ? n : e) / 2, d += (a.dummy ? n : e) / 2, d += a.width / 2, Object.hasOwn(a, "labelpos"))
      switch (a.labelpos.toLowerCase()) {
        case "l":
          l = a.width / 2;
          break;
        case "r":
          l = -a.width / 2;
          break;
      }
    return l && (d += t ? l : -l), d;
  };
}
function St(e, n) {
  return e.node(n).width;
}
function un(e) {
  e = A(e), Ft(e), Object.entries(ln(e)).forEach(([n, t]) => e.node(n).x = t);
}
function Ft(e) {
  let n = N(e), t = e.graph(), r = t.ranksep, o = t.rankalign, i = 0;
  n.forEach((s) => {
    let a = s.reduce((d, l) => {
      var c;
      let u = (c = e.node(l).height) != null ? c : 0;
      return d > u ? d : u;
    }, 0);
    s.forEach((d) => {
      let l = e.node(d);
      o === "top" ? l.y = i + l.height / 2 : o === "bottom" ? l.y = i + a - l.height / 2 : l.y = i + a / 2;
    }), i += a + r;
  });
}
function he(e, n = {}) {
  let t = n.debugTiming ? P : M;
  return t("layout", () => {
    let r = t("  buildLayoutGraph", () => Xt(e));
    return t("  runLayout", () => Dt(r, t, n)), t("  updateInputGraph", () => At(e, r)), r;
  });
}
function Dt(e, n, t) {
  n("    makeSpaceForEdgeLabels", () => Ut(e)), n("    removeSelfEdges", () => rr(e)), n("    acyclic", () => je(e)), n("    nestingGraph.run", () => Ke(e)), n("    rank", () => Xe(A(e))), n("    injectEdgeLabelProxies", () => Kt(e)), n("    removeEmptyRanks", () => Oe(e)), n("    nestingGraph.cleanup", () => Je(e)), n("    normalizeRanks", () => Te(e)), n("    assignRankMinMax", () => $t(e)), n("    removeEdgeLabelProxies", () => Jt(e)), n("    normalize.run", () => Fe(e)), n("    parentDummyChains", () => Ue(e)), n("    addBorderSegments", () => Ze(e)), n("    order", () => B(e, t)), n("    insertSelfEdges", () => or(e)), n("    adjustCoordinateSystem", () => nn(e)), n("    position", () => un(e)), n("    positionSelfEdges", () => ir(e)), n("    removeBorderNodes", () => tr(e)), n("    normalize.undo", () => De(e)), n("    fixupEdgeLabelCoords", () => er(e)), n("    undoCoordinateSystem", () => tn(e)), n("    translateGraph", () => Qt(e)), n("    assignNodeIntersects", () => Zt(e)), n("    reversePoints", () => nr(e)), n("    acyclic.undo", () => Se(e));
}
function At(e, n) {
  e.nodes().forEach((t) => {
    let r = e.node(t), o = n.node(t);
    r && (r.x = o.x, r.y = o.y, r.order = o.order, r.rank = o.rank, n.children(t).length && (r.width = o.width, r.height = o.height));
  }), e.edges().forEach((t) => {
    let r = e.edge(t), o = n.edge(t);
    r.points = o.points, Object.hasOwn(o, "x") && (r.x = o.x, r.y = o.y);
  }), e.graph().width = n.graph().width, e.graph().height = n.graph().height;
}
var Vt = ["nodesep", "edgesep", "ranksep", "marginx", "marginy"];
var Wt = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: "TB", rankalign: "center" };
var Bt = ["acyclicer", "ranker", "rankdir", "align", "rankalign"];
var Yt = ["width", "height", "rank"];
var cn = { width: 0, height: 0 };
var zt = ["minlen", "weight", "width", "height", "labeloffset"];
var Ht = { minlen: 1, weight: 1, width: 0, height: 0, labeloffset: 10, labelpos: "r" };
var qt = ["labelpos"];
function Xt(e) {
  let n = new p({ multigraph: true, compound: true }), t = ce(e.graph());
  return n.setGraph(Object.assign({}, Wt, ue(t, Vt), T(t, Bt))), e.nodes().forEach((r) => {
    let o = ce(e.node(r)), i = ue(o, Yt);
    Object.keys(cn).forEach((a) => {
      i[a] === undefined && (i[a] = cn[a]);
    }), n.setNode(r, i);
    let s = e.parent(r);
    s !== undefined && n.setParent(r, s);
  }), e.edges().forEach((r) => {
    let o = ce(e.edge(r));
    n.setEdge(r, Object.assign({}, Ht, ue(o, zt), T(o, qt)));
  }), n;
}
function Ut(e) {
  let n = e.graph();
  n.ranksep /= 2, e.edges().forEach((t) => {
    let r = e.edge(t);
    r.minlen *= 2, r.labelpos.toLowerCase() !== "c" && (n.rankdir === "TB" || n.rankdir === "BT" ? r.width += r.labeloffset : r.height += r.labeloffset);
  });
}
function Kt(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (t.width && t.height) {
      let r = e.node(n.v), i = { rank: (e.node(n.w).rank - r.rank) / 2 + r.rank, e: n };
      w(e, "edge-proxy", i, "_ep");
    }
  });
}
function $t(e) {
  let n = 0;
  e.nodes().forEach((t) => {
    let r = e.node(t);
    r.borderTop && (r.minRank = e.node(r.borderTop).rank, r.maxRank = e.node(r.borderBottom).rank, n = Math.max(n, r.maxRank));
  }), e.graph().maxRank = n;
}
function Jt(e) {
  e.nodes().forEach((n) => {
    let t = e.node(n);
    if (t.dummy === "edge-proxy") {
      let r = t;
      e.edge(r.e).labelRank = t.rank, e.removeNode(n);
    }
  });
}
function Qt(e) {
  let n = Number.POSITIVE_INFINITY, t = 0, r = Number.POSITIVE_INFINITY, o = 0, i = e.graph(), s = i.marginx || 0, a = i.marginy || 0;
  function d(l) {
    let { x: u, y: c, width: h, height: f } = l;
    n = Math.min(n, u - h / 2), t = Math.max(t, u + h / 2), r = Math.min(r, c - f / 2), o = Math.max(o, c + f / 2);
  }
  e.nodes().forEach((l) => d(e.node(l))), e.edges().forEach((l) => {
    let u = e.edge(l);
    Object.hasOwn(u, "x") && d(u);
  }), n -= s, r -= a, e.nodes().forEach((l) => {
    let u = e.node(l);
    u.x -= n, u.y -= r;
  }), e.edges().forEach((l) => {
    let u = e.edge(l);
    u.points.forEach((c) => {
      c.x -= n, c.y -= r;
    }), Object.hasOwn(u, "x") && (u.x -= n), Object.hasOwn(u, "y") && (u.y -= r);
  }), i.width = t - n + s, i.height = o - r + a;
}
function Zt(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n), r = e.node(n.v), o = e.node(n.w), i, s;
    t.points ? (i = t.points[0], s = t.points[t.points.length - 1]) : (t.points = [], i = o, s = r), t.points.unshift(H(r, i)), t.points.push(H(o, s));
  });
}
function er(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (Object.hasOwn(t, "x"))
      switch ((t.labelpos === "l" || t.labelpos === "r") && (t.width -= t.labeloffset), t.labelpos) {
        case "l":
          t.x -= t.width / 2 + t.labeloffset;
          break;
        case "r":
          t.x += t.width / 2 + t.labeloffset;
          break;
      }
  });
}
function nr(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    t.reversed && t.points.reverse();
  });
}
function tr(e) {
  e.nodes().forEach((n) => {
    if (e.children(n).length) {
      let t = e.node(n), r = e.node(t.borderTop), o = e.node(t.borderBottom), i = e.node(t.borderLeft[t.borderLeft.length - 1]), s = e.node(t.borderRight[t.borderRight.length - 1]);
      t.width = Math.abs(s.x - i.x), t.height = Math.abs(o.y - r.y), t.x = i.x + t.width / 2, t.y = r.y + t.height / 2;
    }
  }), e.nodes().forEach((n) => {
    e.node(n).dummy === "border" && e.removeNode(n);
  });
}
function rr(e) {
  e.edges().forEach((n) => {
    if (n.v === n.w) {
      let t = e.node(n.v);
      t.selfEdges || (t.selfEdges = []), t.selfEdges.push({ e: n, label: e.edge(n) }), e.removeEdge(n);
    }
  });
}
function or(e) {
  N(e).forEach((t) => {
    let r = 0;
    t.forEach((o, i) => {
      let s = e.node(o);
      s.order = i + r, (s.selfEdges || []).forEach((a) => {
        w(e, "selfedge", { width: a.label.width, height: a.label.height, rank: s.rank, order: i + ++r, e: a.e, label: a.label }, "_se");
      }), delete s.selfEdges;
    });
  });
}
function ir(e) {
  e.nodes().forEach((n) => {
    let t = e.node(n);
    if (t.dummy === "selfedge") {
      let r = t, o = e.node(r.e.v), i = o.x + o.width / 2, s = o.y, a = t.x - i, d = o.height / 2;
      e.setEdge(r.e, r.label), e.removeNode(n), r.label.points = [{ x: i + 2 * a / 3, y: s - d }, { x: i + 5 * a / 6, y: s - d }, { x: i + a, y: s }, { x: i + 5 * a / 6, y: s + d }, { x: i + 2 * a / 3, y: s + d }], r.label.x = t.x, r.label.y = t.y;
    }
  });
}
function ue(e, n) {
  return O(T(e, n), Number);
}
function ce(e) {
  let n = {};
  return e && Object.entries(e).forEach(([t, r]) => {
    typeof t == "string" && (t = t.toLowerCase()), n[t] = r;
  }), n;
}
function fe(e) {
  let n = N(e), t = new p({ compound: true, multigraph: true }).setGraph({});
  return e.nodes().forEach((r) => {
    t.setNode(r, { label: r }), t.setParent(r, "layer" + e.node(r).rank);
  }), e.edges().forEach((r) => t.setEdge(r.v, r.w, {}, r.name)), n.forEach((r, o) => {
    let i = "layer" + o;
    t.setNode(i, { rank: "same" }), r.reduce((s, a) => (t.setEdge(s, a, { style: "invis" }), a));
  }), t;
}
var xo = { time: P, notime: M };
var sr = { graphlib: z, version: U, layout: he, debug: fe, util: { time: P, notime: M } };
var To = sr;
/*! For license information please see dagre.esm.js.LEGAL.txt */

// src/parser/ast.ts
function getDirective(doc, key, fallback) {
  const d = doc.directives.find((d2) => d2.key === key);
  return d ? d.value : fallback;
}
function getDirection(doc) {
  const val = getDirective(doc, "direction", "TB").toUpperCase();
  if (val === "TB" || val === "BT" || val === "LR" || val === "RL")
    return val;
  return "TB";
}
function getRouting(doc) {
  const val = getDirective(doc, "routing", "orthogonal").toLowerCase();
  if (val === "orthogonal" || val === "bezier" || val === "polyline")
    return val;
  return "orthogonal";
}

// src/layout/dagre-layout.ts
var { Graph } = exports_dagre_esm;
var SHAPE_SIZES = {
  start: { width: 180, height: 44 },
  end: { width: 180, height: 44 },
  decision: { width: 160, height: 100 },
  process: { width: 180, height: 44 },
  subprocess: { width: 180, height: 44 },
  io: { width: 180, height: 44 },
  data: { width: 160, height: 50 },
  circle: { width: 60, height: 60 },
  note: { width: 180, height: 60 },
  manual: { width: 180, height: 44 },
  delay: { width: 180, height: 44 }
};
function estimateTextWidth(text, fontSize = 13) {
  const avgCharWidth = fontSize * 0.58;
  return text.length * avgCharWidth + 32;
}
function layoutDocument(doc) {
  const direction = getDirection(doc);
  const spacing = parseInt(getDirective(doc, "spacing", "60"), 10);
  const g = new Graph({ compound: true });
  g.setGraph({
    rankdir: direction,
    nodesep: spacing,
    ranksep: spacing + 20,
    marginx: 40,
    marginy: 40
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const group of doc.groups) {
    g.setNode(group.id, {
      label: group.label,
      clusterLabelPos: "top"
    });
  }
  for (const [id, node] of doc.nodes) {
    const defaults = SHAPE_SIZES[node.shape] ?? SHAPE_SIZES.process;
    const textWidth = estimateTextWidth(node.label);
    const width = Math.max(defaults.width, textWidth);
    const height = defaults.height;
    node.width = width;
    node.height = height;
    g.setNode(id, { width, height, label: node.label });
    if (node.group) {
      g.setParent(id, node.group);
    }
  }
  for (const edge of doc.edges) {
    g.setEdge(edge.from, edge.to, {
      label: edge.label ?? "",
      minlen: 1,
      weight: edge.condition ? 1 : 2
    });
  }
  he(g);
  for (const [id, node] of doc.nodes) {
    const layoutNode = g.node(id);
    if (layoutNode) {
      node.x = layoutNode.x;
      node.y = layoutNode.y;
      node.width = layoutNode.width;
      node.height = layoutNode.height;
    }
  }
  for (const group of doc.groups) {
    const layoutNode = g.node(group.id);
    if (layoutNode) {
      group.x = layoutNode.x;
      group.y = layoutNode.y;
      group.width = layoutNode.width;
      group.height = layoutNode.height;
    }
  }
  for (const edge of doc.edges) {
    const dagreEdge = g.edge(edge.from, edge.to);
    if (dagreEdge?.points) {
      edge.points = dagreEdge.points.map((p2) => ({
        x: Math.round(p2.x),
        y: Math.round(p2.y)
      }));
    }
  }
  if (doc.lanes.length > 0) {
    applySwimlaneLayout(doc, spacing);
  }
}
function applySwimlaneLayout(doc, spacing) {
  const LANE_PAD = 40;
  const LANE_GAP = 8;
  const HEADER_WIDTH = 120;
  const laneNodeWidths = new Map;
  for (const lane of doc.lanes) {
    let maxW = 180;
    for (const nid of lane.children) {
      const node = doc.nodes.get(nid);
      if (node)
        maxW = Math.max(maxW, node.width ?? 180);
    }
    laneNodeWidths.set(lane.id, maxW);
  }
  const laneX = new Map;
  let xCursor = HEADER_WIDTH;
  for (const lane of doc.lanes) {
    const nodeW = laneNodeWidths.get(lane.id) ?? 180;
    const colWidth = nodeW + LANE_PAD * 2;
    laneX.set(lane.id, {
      left: xCursor,
      center: xCursor + colWidth / 2,
      width: colWidth
    });
    xCursor += colWidth + LANE_GAP;
  }
  const yValues = new Set;
  for (const [_2, node] of doc.nodes) {
    if (node.y !== undefined)
      yValues.add(Math.round(node.y));
  }
  for (const [_2, node] of doc.nodes) {
    if (node.lane) {
      const col = laneX.get(node.lane);
      if (col) {
        node.x = col.center;
      }
    }
  }
  const rankBuckets = new Map;
  for (const [_2, node] of doc.nodes) {
    if (!node.lane)
      continue;
    const key = `${node.lane}::${Math.round(node.y ?? 0)}`;
    if (!rankBuckets.has(key))
      rankBuckets.set(key, []);
    rankBuckets.get(key).push(node);
  }
  for (const [_2, bucket] of rankBuckets) {
    if (bucket.length <= 1)
      continue;
    const totalH = bucket.reduce((sum, n) => sum + (n.height ?? 44), 0) + (bucket.length - 1) * 20;
    let yOff = (bucket[0].y ?? 0) - totalH / 2 + (bucket[0].height ?? 44) / 2;
    for (const n of bucket) {
      n.y = yOff + (n.height ?? 44) / 2;
      yOff += (n.height ?? 44) + 20;
    }
  }
  let minY = Infinity, maxY = -Infinity;
  for (const [_2, node] of doc.nodes) {
    if (node.y === undefined)
      continue;
    const hh = (node.height ?? 44) / 2;
    minY = Math.min(minY, node.y - hh);
    maxY = Math.max(maxY, node.y + hh);
  }
  if (minY === Infinity) {
    minY = 0;
    maxY = 400;
  }
  const topPad = 40;
  const bottomPad = 40;
  for (const lane of doc.lanes) {
    const col = laneX.get(lane.id);
    if (!col)
      continue;
    lane.width = col.width;
    lane.height = maxY - minY + topPad + bottomPad;
    lane.x = col.left + col.width / 2;
    lane.y = minY - topPad + lane.height / 2;
  }
}
// src/layout/router.ts
function routeEdges(doc) {
  const style = getRouting(doc);
  const cornerRadius = parseInt(getDirective(doc, "corner-radius", "8"), 10);
  const routes = new Map;
  const hasLanes = doc.lanes.length > 0;
  const portUsage = new Map;
  const portIndex = new Map;
  if (hasLanes) {
    for (const edge of doc.edges) {
      const fromNode = doc.nodes.get(edge.from);
      const toNode = doc.nodes.get(edge.to);
      if (!fromNode || !toNode)
        continue;
      const { exitDir, entryDir } = chooseCardinalDirs(fromNode, toNode, edge);
      const exitKey = `${edge.from}:${exitDir}:exit`;
      const entryKey = `${edge.to}:${entryDir}:entry`;
      portUsage.set(exitKey, (portUsage.get(exitKey) ?? 0) + 1);
      portUsage.set(entryKey, (portUsage.get(entryKey) ?? 0) + 1);
    }
    const portCursor = new Map;
    for (const edge of doc.edges) {
      const fromNode = doc.nodes.get(edge.from);
      const toNode = doc.nodes.get(edge.to);
      if (!fromNode || !toNode)
        continue;
      const { exitDir, entryDir } = chooseCardinalDirs(fromNode, toNode, edge);
      const exitKey = `${edge.from}:${exitDir}:exit`;
      const entryKey = `${edge.to}:${entryDir}:entry`;
      const edgeKey = `${edge.from}->${edge.to}`;
      const ei = portCursor.get(exitKey) ?? 0;
      const ni = portCursor.get(entryKey) ?? 0;
      portIndex.set(`exit:${edgeKey}`, ei);
      portIndex.set(`entry:${edgeKey}`, ni);
      portCursor.set(exitKey, ei + 1);
      portCursor.set(entryKey, ni + 1);
    }
  }
  for (const edge of doc.edges) {
    const fromNode = doc.nodes.get(edge.from);
    const toNode = doc.nodes.get(edge.to);
    if (!fromNode || !toNode)
      continue;
    const key = `${edge.from}->${edge.to}`;
    let result;
    if (hasLanes) {
      result = routeCardinal(edge, fromNode, toNode, cornerRadius, portUsage, portIndex);
    } else {
      result = routeEdge(edge, fromNode, toNode, style, cornerRadius);
    }
    routes.set(key, result);
  }
  return routes;
}
function routeEdge(edge, from, to, style, cornerRadius) {
  switch (style) {
    case "orthogonal":
      return routeOrthogonal(edge, from, to, cornerRadius);
    case "bezier":
      return routeBezier(from, to);
    case "polyline":
      return routePolyline(from, to);
  }
}
function getNodeCenter(node) {
  return { x: node.x ?? 0, y: node.y ?? 0 };
}
function getNodePorts(node) {
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const hw = (node.width ?? 180) / 2;
  const hh = (node.height ?? 44) / 2;
  if (node.shape === "decision") {
    return {
      top: { x: cx, y: cy - hh },
      bottom: { x: cx, y: cy + hh },
      left: { x: cx - hw * 0.9, y: cy },
      right: { x: cx + hw * 0.9, y: cy }
    };
  }
  return {
    top: { x: cx, y: cy - hh },
    bottom: { x: cx, y: cy + hh },
    left: { x: cx - hw, y: cy },
    right: { x: cx + hw, y: cy }
  };
}
function choosePorts(from, to, edge) {
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);
  const fc = getNodeCenter(from);
  const tc = getNodeCenter(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  if (from.shape === "decision") {
    if (edge.condition === "yes" || edge.condition === "true" || !edge.condition && Math.abs(dy) > Math.abs(dx)) {
      return { exit: fromPorts.bottom, entry: toPorts.top };
    }
    if (edge.condition === "no" || edge.condition === "false") {
      if (dx >= 0)
        return { exit: fromPorts.right, entry: toPorts.left };
      return { exit: fromPorts.left, entry: toPorts.right };
    }
  }
  if (Math.abs(dy) > Math.abs(dx)) {
    if (dy > 0)
      return { exit: fromPorts.bottom, entry: toPorts.top };
    return { exit: fromPorts.top, entry: toPorts.bottom };
  } else {
    if (dx > 0)
      return { exit: fromPorts.right, entry: toPorts.left };
    return { exit: fromPorts.left, entry: toPorts.right };
  }
}
function chooseCardinalDirs(from, to, edge) {
  const dx = (to.x ?? 0) - (from.x ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  const sameLane = from.lane && from.lane === to.lane;
  if (sameLane || Math.abs(dx) < 10) {
    if (from.shape === "decision") {
      if (edge.condition === "no" || edge.condition === "false") {
        return { exitDir: dx >= 0 ? "E" : "W", entryDir: dy >= 0 ? "N" : "S" };
      }
    }
    return dy >= 0 ? { exitDir: "S", entryDir: "N" } : { exitDir: "N", entryDir: "S" };
  }
  if (from.shape === "decision") {
    if (edge.condition === "yes" || edge.condition === "true") {
      return { exitDir: "S", entryDir: "N" };
    }
  }
  const exitDir = dx > 0 ? "E" : "W";
  if (Math.abs(dy) > 30) {
    return { exitDir, entryDir: dy > 0 ? "N" : "S" };
  }
  return { exitDir, entryDir: dx > 0 ? "W" : "E" };
}
function getSpreadPort(node, dir, index, total) {
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const hw = (node.width ?? 180) / 2;
  const hh = (node.height ?? 44) / 2;
  const spreadH = (node.width ?? 180) * 0.6;
  const spreadV = (node.height ?? 44) * 0.6;
  const offsetH = total <= 1 ? 0 : (index / (total - 1) - 0.5) * spreadH;
  const offsetV = total <= 1 ? 0 : (index / (total - 1) - 0.5) * spreadV;
  if (node.shape === "decision") {
    switch (dir) {
      case "N":
        return { x: cx, y: cy - hh };
      case "S":
        return { x: cx, y: cy + hh };
      case "E":
        return { x: cx + hw * 0.9, y: cy };
      case "W":
        return { x: cx - hw * 0.9, y: cy };
    }
  }
  switch (dir) {
    case "N":
      return { x: cx + offsetH, y: cy - hh };
    case "S":
      return { x: cx + offsetH, y: cy + hh };
    case "E":
      return { x: cx + hw, y: cy + offsetV };
    case "W":
      return { x: cx - hw, y: cy + offsetV };
  }
}
function routeCardinal(edge, from, to, cornerRadius, portUsage, portIndex) {
  const { exitDir, entryDir } = chooseCardinalDirs(from, to, edge);
  const edgeKey = `${edge.from}->${edge.to}`;
  const exitTotal = portUsage.get(`${edge.from}:${exitDir}:exit`) ?? 1;
  const exitIdx = portIndex.get(`exit:${edgeKey}`) ?? 0;
  const entryTotal = portUsage.get(`${edge.to}:${entryDir}:entry`) ?? 1;
  const entryIdx = portIndex.get(`entry:${edgeKey}`) ?? 0;
  const exit = getSpreadPort(from, exitDir, exitIdx, exitTotal);
  const entry = getSpreadPort(to, entryDir, entryIdx, entryTotal);
  const r = cornerRadius;
  const waypoints = [exit];
  const dx = entry.x - exit.x;
  const dy = entry.y - exit.y;
  if (exitDir === "S" && entryDir === "N") {
    if (Math.abs(dx) < 2) {} else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  } else if (exitDir === "N" && entryDir === "S") {
    if (Math.abs(dx) < 2) {} else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  } else if ((exitDir === "E" || exitDir === "W") && entryDir === "N") {
    waypoints.push({ x: entry.x, y: exit.y });
  } else if ((exitDir === "E" || exitDir === "W") && entryDir === "S") {
    waypoints.push({ x: entry.x, y: exit.y });
  } else if ((exitDir === "E" || exitDir === "W") && (entryDir === "E" || entryDir === "W")) {
    const midX = exit.x + dx / 2;
    waypoints.push({ x: midX, y: exit.y });
    waypoints.push({ x: midX, y: entry.y });
  } else if (exitDir === "S" && (entryDir === "E" || entryDir === "W")) {
    waypoints.push({ x: exit.x, y: entry.y });
  } else if (exitDir === "N" && (entryDir === "E" || entryDir === "W")) {
    waypoints.push({ x: exit.x, y: entry.y });
  } else {
    if (Math.abs(dx) > Math.abs(dy)) {
      const midX = exit.x + dx / 2;
      waypoints.push({ x: midX, y: exit.y });
      waypoints.push({ x: midX, y: entry.y });
    } else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  }
  waypoints.push(entry);
  const pathData = waypointsToRoundedPath(waypoints, r);
  const labelPos = getPathMidpoint(waypoints);
  return { pathData, labelPosition: labelPos };
}
function routeOrthogonal(edge, from, to, cornerRadius) {
  const { exit, entry } = choosePorts(from, to, edge);
  const r = cornerRadius;
  const waypoints = [exit];
  const dx = entry.x - exit.x;
  const dy = entry.y - exit.y;
  const exitDir = getPortDirection(from, exit);
  const entryDir = getPortDirection(to, entry);
  if (exitDir === "down" && entryDir === "up") {
    if (Math.abs(dx) < 2) {} else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  } else if (exitDir === "right" && entryDir === "up") {
    waypoints.push({ x: entry.x, y: exit.y });
  } else if (exitDir === "left" && entryDir === "up") {
    waypoints.push({ x: entry.x, y: exit.y });
  } else if (exitDir === "right" && entryDir === "left") {
    const midX = exit.x + dx / 2;
    waypoints.push({ x: midX, y: exit.y });
    waypoints.push({ x: midX, y: entry.y });
  } else if (exitDir === "down" && entryDir === "left") {
    waypoints.push({ x: exit.x, y: entry.y });
  } else {
    if (Math.abs(dx) > Math.abs(dy)) {
      const midX = exit.x + dx / 2;
      waypoints.push({ x: midX, y: exit.y });
      waypoints.push({ x: midX, y: entry.y });
    } else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  }
  waypoints.push(entry);
  const pathData = waypointsToRoundedPath(waypoints, r);
  const labelPos = getPathMidpoint(waypoints);
  return { pathData, labelPosition: labelPos };
}
function getPortDirection(node, port) {
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const dx = port.x - cx;
  const dy = port.y - cy;
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 ? "down" : "up";
  }
  return dx > 0 ? "right" : "left";
}
function waypointsToRoundedPath(points, radius) {
  if (points.length < 2)
    return "";
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1;i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
    const toNext = { x: next.x - curr.x, y: next.y - curr.y };
    const lenPrev = Math.sqrt(toPrev.x ** 2 + toPrev.y ** 2);
    const lenNext = Math.sqrt(toNext.x ** 2 + toNext.y ** 2);
    const r = Math.min(radius, lenPrev / 2, lenNext / 2);
    if (r < 1) {
      d += ` L${curr.x},${curr.y}`;
      continue;
    }
    const startX = curr.x + toPrev.x / lenPrev * r;
    const startY = curr.y + toPrev.y / lenPrev * r;
    const endX = curr.x + toNext.x / lenNext * r;
    const endY = curr.y + toNext.y / lenNext * r;
    d += ` L${startX},${startY}`;
    d += ` Q${curr.x},${curr.y} ${endX},${endY}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}
function routeBezier(from, to) {
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);
  const fc = getNodeCenter(from);
  const tc = getNodeCenter(to);
  const dy = tc.y - fc.y;
  const exit = dy >= 0 ? fromPorts.bottom : fromPorts.top;
  const entry = dy >= 0 ? toPorts.top : toPorts.bottom;
  const cpDist = Math.abs(dy) * 0.4 + 20;
  const cp1 = { x: exit.x, y: exit.y + (dy >= 0 ? cpDist : -cpDist) };
  const cp2 = { x: entry.x, y: entry.y - (dy >= 0 ? cpDist : -cpDist) };
  const pathData = `M${exit.x},${exit.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${entry.x},${entry.y}`;
  const labelPos = {
    x: (exit.x + entry.x) / 2,
    y: (exit.y + entry.y) / 2
  };
  return { pathData, labelPosition: labelPos };
}
function routePolyline(from, to) {
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);
  const fc = getNodeCenter(from);
  const tc = getNodeCenter(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  let exit, entry;
  if (Math.abs(dy) > Math.abs(dx)) {
    exit = dy > 0 ? fromPorts.bottom : fromPorts.top;
    entry = dy > 0 ? toPorts.top : toPorts.bottom;
  } else {
    exit = dx > 0 ? fromPorts.right : fromPorts.left;
    entry = dx > 0 ? toPorts.left : toPorts.right;
  }
  const pathData = `M${exit.x},${exit.y} L${entry.x},${entry.y}`;
  const labelPos = {
    x: (exit.x + entry.x) / 2,
    y: (exit.y + entry.y) / 2
  };
  return { pathData, labelPosition: labelPos };
}
function getPathMidpoint(points) {
  if (points.length === 0)
    return { x: 0, y: 0 };
  if (points.length === 1)
    return points[0];
  let totalLen = 0;
  const segLens = [];
  for (let i = 1;i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    totalLen += len;
  }
  let targetLen = totalLen / 2;
  for (let i = 0;i < segLens.length; i++) {
    if (targetLen <= segLens[i]) {
      const t = targetLen / segLens[i];
      return {
        x: Math.round(points[i].x + (points[i + 1].x - points[i].x) * t),
        y: Math.round(points[i].y + (points[i + 1].y - points[i].y) * t)
      };
    }
    targetLen -= segLens[i];
  }
  const mid = Math.floor(points.length / 2);
  return points[mid];
}
// src/render/svg-tree.ts
function el(tag, attrs = {}, ...children) {
  return { tag, attrs, children };
}
function serializeToSVG(root, indent = 0) {
  const pad = "  ".repeat(indent);
  const attrs = Object.entries(root.attrs).map(([k2, v2]) => `${k2}="${escapeAttr(String(v2))}"`).join(" ");
  const openTag = attrs ? `<${root.tag} ${attrs}` : `<${root.tag}`;
  if (root.children.length === 0) {
    return `${pad}${openTag}/>`;
  }
  const allText = root.children.every((c) => typeof c === "string");
  if (allText) {
    const textContent = root.children.map((c) => escapeXml(String(c))).join("");
    return `${pad}${openTag}>${textContent}</${root.tag}>`;
  }
  const childLines = root.children.map((child) => {
    if (typeof child === "string") {
      return `${"  ".repeat(indent + 1)}${escapeXml(child)}`;
    }
    return serializeToSVG(child, indent + 1);
  });
  return `${pad}${openTag}>
${childLines.join(`
`)}
${pad}</${root.tag}>`;
}
function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/render/shapes/index.ts
function renderNode(node, theme) {
  const shapeStyle = theme.shapes[node.shape] ?? theme.shapes.process;
  const fill = node.style?.fill ?? shapeStyle.fill;
  const stroke = node.style?.stroke ?? shapeStyle.stroke;
  const textColor = node.style?.text ?? shapeStyle.textColor ?? theme.node.font.color;
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const w2 = node.width ?? 180;
  const h = node.height ?? 44;
  const shapeEl = renderShapeBackground(node.shape, cx, cy, w2, h, fill, stroke, theme);
  const textEl = renderLabel(node.label, cx, cy, w2, textColor, theme);
  return el("g", {
    class: "fs-node",
    "data-node-id": node.id,
    "data-shape": node.shape
  }, ...theme.node.shadow ? [wrapWithShadow(shapeEl)] : [shapeEl], textEl);
}
function renderShapeBackground(shape, cx, cy, w2, h, fill, stroke, theme) {
  const sw = theme.node.strokeWidth;
  const r = theme.node.borderRadius;
  switch (shape) {
    case "start":
    case "end":
      return el("rect", {
        x: cx - w2 / 2,
        y: cy - h / 2,
        width: w2,
        height: h,
        rx: h / 2,
        fill,
        stroke,
        "stroke-width": sw
      });
    case "decision":
      return el("polygon", {
        points: `${cx},${cy - h / 2} ${cx + w2 / 2},${cy} ${cx},${cy + h / 2} ${cx - w2 / 2},${cy}`,
        fill,
        stroke,
        "stroke-width": sw
      });
    case "io": {
      const skew = 15;
      const points = [
        `${cx - w2 / 2 + skew},${cy - h / 2}`,
        `${cx + w2 / 2 + skew},${cy - h / 2}`,
        `${cx + w2 / 2 - skew},${cy + h / 2}`,
        `${cx - w2 / 2 - skew},${cy + h / 2}`
      ].join(" ");
      return el("polygon", { points, fill, stroke, "stroke-width": sw });
    }
    case "data":
      return el("rect", {
        x: cx - w2 / 2,
        y: cy - h / 2,
        width: w2,
        height: h,
        rx: 4,
        fill,
        stroke,
        "stroke-width": sw
      });
    case "circle": {
      const radius = Math.min(w2, h) / 2;
      return el("circle", {
        cx,
        cy,
        r: radius,
        fill,
        stroke,
        "stroke-width": sw
      });
    }
    case "subprocess":
      return el("g", {}, el("rect", {
        x: cx - w2 / 2,
        y: cy - h / 2,
        width: w2,
        height: h,
        rx: r,
        fill,
        stroke,
        "stroke-width": sw
      }), el("line", {
        x1: cx - w2 / 2 + 8,
        y1: cy - h / 2,
        x2: cx - w2 / 2 + 8,
        y2: cy + h / 2,
        stroke,
        "stroke-width": 0.8
      }), el("line", {
        x1: cx + w2 / 2 - 8,
        y1: cy - h / 2,
        x2: cx + w2 / 2 - 8,
        y2: cy + h / 2,
        stroke,
        "stroke-width": 0.8
      }));
    case "manual": {
      const inset = 12;
      const points = [
        `${cx - w2 / 2},${cy - h / 2}`,
        `${cx + w2 / 2},${cy - h / 2}`,
        `${cx + w2 / 2 - inset},${cy + h / 2}`,
        `${cx - w2 / 2 + inset},${cy + h / 2}`
      ].join(" ");
      return el("polygon", { points, fill, stroke, "stroke-width": sw });
    }
    case "delay": {
      const x2 = cx - w2 / 2;
      const y = cy - h / 2;
      const rr2 = h / 2;
      const d = `M${x2},${y} L${x2 + w2 - rr2},${y} A${rr2},${rr2} 0 0 1 ${x2 + w2 - rr2},${y + h} L${x2},${y + h} Z`;
      return el("path", { d, fill, stroke, "stroke-width": sw });
    }
    case "note": {
      const x2 = cx - w2 / 2;
      const y = cy - h / 2;
      const fold = 12;
      const d = `M${x2},${y} L${x2 + w2 - fold},${y} L${x2 + w2},${y + fold} L${x2 + w2},${y + h} L${x2},${y + h} Z`;
      return el("g", {}, el("path", { d, fill, stroke, "stroke-width": sw }), el("path", {
        d: `M${x2 + w2 - fold},${y} L${x2 + w2 - fold},${y + fold} L${x2 + w2},${y + fold}`,
        fill: "none",
        stroke,
        "stroke-width": 0.8
      }));
    }
    case "process":
    default:
      return el("rect", {
        x: cx - w2 / 2,
        y: cy - h / 2,
        width: w2,
        height: h,
        rx: r,
        fill,
        stroke,
        "stroke-width": sw
      });
  }
}
function renderLabel(label, cx, cy, maxWidth, color, theme) {
  const font = theme.node.font;
  const charWidth = font.size * 0.58;
  const maxChars = Math.floor((maxWidth - 20) / charWidth);
  if (label.length <= maxChars) {
    return el("text", {
      x: cx,
      y: cy,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-family": font.family,
      "font-size": font.size,
      "font-weight": font.weight,
      fill: color,
      class: "fs-label"
    }, label);
  }
  const words = label.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && (current + " " + word).length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current)
    lines.push(current);
  const lineHeight = font.size * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = cy - totalHeight / 2 + lineHeight / 2;
  const tspans = lines.map((line, i) => el("tspan", {
    x: cx,
    dy: i === 0 ? 0 : lineHeight
  }, line));
  return el("text", {
    x: cx,
    y: startY,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-family": font.family,
    "font-size": font.size,
    "font-weight": font.weight,
    fill: color,
    class: "fs-label"
  }, ...tspans);
}
function wrapWithShadow(child) {
  return el("g", { filter: "url(#fs-shadow)" }, child);
}

// src/render/svg.ts
function renderSVG(doc, routes, options) {
  const { theme, padding = 40 } = options;
  const bounds = calculateBounds(doc, padding);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const root = el("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: `${bounds.minX} ${bounds.minY} ${width} ${height}`,
    width,
    height,
    class: "fs-diagram"
  }, renderDefs(theme), renderLanes(doc, theme), renderGroups(doc, theme), renderEdges(doc, routes, theme), renderNodes(doc, theme));
  return serializeToSVG(root);
}
function renderDefs(theme) {
  return el("defs", {}, el("marker", {
    id: "fs-arrow",
    markerWidth: theme.edge.arrowSize,
    markerHeight: theme.edge.arrowSize * 0.8,
    refX: theme.edge.arrowSize - 1,
    refY: theme.edge.arrowSize * 0.4,
    orient: "auto"
  }, el("path", {
    d: `M0,0 L${theme.edge.arrowSize},${theme.edge.arrowSize * 0.4} L0,${theme.edge.arrowSize * 0.8} Z`,
    fill: theme.edge.stroke
  })), el("filter", {
    id: "fs-shadow",
    x: "-4%",
    y: "-4%",
    width: "108%",
    height: "112%"
  }, el("feDropShadow", {
    dx: 0,
    dy: 2,
    stdDeviation: 3,
    "flood-color": "#00000018"
  })));
}
function renderLanes(doc, theme) {
  if (doc.lanes.length === 0)
    return el("g", {});
  const laneEls = [];
  const headerWidth = theme.lane.headerWidth;
  const font = theme.lane.labelFont;
  const labelColors = ["#334155", "#854d0e", "#166534", "#5b21b6", "#9f1239"];
  let topY = Infinity, bottomY = -Infinity;
  for (const lane of doc.lanes) {
    if (lane.y === undefined || lane.height === undefined)
      continue;
    const lTop = lane.y - lane.height / 2;
    const lBot = lane.y + lane.height / 2;
    if (lTop < topY)
      topY = lTop;
    if (lBot > bottomY)
      bottomY = lBot;
  }
  if (topY === Infinity)
    return el("g", {});
  const totalHeight = bottomY - topY;
  for (let i = 0;i < doc.lanes.length; i++) {
    const lane = doc.lanes[i];
    if (lane.x === undefined || lane.y === undefined)
      continue;
    const lw = lane.width ?? 260;
    const lh = totalHeight;
    const lx = lane.x - lw / 2;
    const ly = topY;
    const colorIdx = i % theme.lane.fills.length;
    const fill = lane.style?.fill ?? theme.lane.fills[colorIdx];
    const stroke = lane.style?.stroke ?? theme.lane.strokes[colorIdx];
    const headerFill = theme.lane.headerFills[colorIdx];
    const labelColor = labelColors[colorIdx % labelColors.length];
    laneEls.push(el("rect", {
      x: lx - headerWidth,
      y: ly,
      width: lw + headerWidth,
      height: lh,
      rx: 6,
      fill,
      stroke,
      "stroke-width": 1,
      class: "fs-lane-bg"
    }));
    laneEls.push(el("rect", {
      x: lx - headerWidth,
      y: ly,
      width: headerWidth,
      height: lh,
      rx: 6,
      fill: headerFill,
      stroke: "none",
      class: "fs-lane-header"
    }));
    laneEls.push(el("rect", {
      x: lx - headerWidth + headerWidth - 6,
      y: ly,
      width: 6,
      height: lh,
      fill: headerFill,
      stroke: "none"
    }));
    const labelCx = lx - headerWidth / 2;
    const labelCy = ly + lh / 2;
    laneEls.push(el("text", {
      x: labelCx,
      y: labelCy,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-family": font.family,
      "font-size": font.size,
      "font-weight": font.weight,
      "letter-spacing": "1",
      fill: labelColor,
      transform: `rotate(-90, ${labelCx}, ${labelCy})`,
      class: "fs-lane-label"
    }, lane.label));
    if (i < doc.lanes.length - 1) {
      const divX = lx + lw + 4;
      laneEls.push(el("line", {
        x1: divX,
        y1: ly + 4,
        x2: divX,
        y2: ly + lh - 4,
        stroke: theme.lane.dividerStroke,
        "stroke-width": 1,
        "stroke-dasharray": theme.lane.dividerDash,
        class: "fs-lane-divider"
      }));
    }
  }
  return el("g", { class: "fs-lanes", "data-lane-count": doc.lanes.length }, ...laneEls);
}
function renderGroups(doc, theme) {
  if (doc.groups.length === 0)
    return el("g", {});
  const groupEls = doc.groups.map((group, index) => {
    if (group.x === undefined || group.y === undefined)
      return el("g", {});
    const gx = group.x - (group.width ?? 200) / 2;
    const gy = group.y - (group.height ?? 300) / 2;
    const gw = group.width ?? 200;
    const gh = group.height ?? 300;
    const colorIdx = index % theme.group.fills.length;
    const fill = group.style?.fill ?? theme.group.fills[colorIdx];
    const stroke = group.style?.stroke ?? theme.group.strokes[colorIdx];
    const headerFill = theme.group.headerFills[colorIdx];
    const font = theme.group.labelFont;
    const labelColors = ["#1e40af", "#166534", "#5b21b6", "#92400e"];
    const labelColor = labelColors[colorIdx % labelColors.length];
    const headerHeight = 32;
    return el("g", {
      class: "fs-group",
      "data-group-id": group.id
    }, el("rect", {
      x: gx,
      y: gy,
      width: gw,
      height: gh,
      rx: 8,
      fill,
      stroke,
      "stroke-width": 1.2
    }), el("rect", {
      x: gx,
      y: gy,
      width: gw,
      height: headerHeight,
      rx: 8,
      fill: headerFill,
      stroke: "none"
    }), el("rect", {
      x: gx,
      y: gy + headerHeight - 8,
      width: gw,
      height: 8,
      fill: headerFill,
      stroke: "none"
    }), el("text", {
      x: gx + gw / 2,
      y: gy + headerHeight / 2 + 2,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-family": font.family,
      "font-size": font.size,
      "font-weight": font.weight,
      "text-transform": "uppercase",
      "letter-spacing": "1",
      fill: labelColor,
      class: "fs-group-label"
    }, group.label));
  });
  return el("g", { class: "fs-groups" }, ...groupEls);
}
function renderEdges(doc, routes, theme) {
  const edgeEls = doc.edges.map((edge) => {
    const key = `${edge.from}->${edge.to}`;
    const route = routes.get(key);
    if (!route)
      return el("g", {});
    const isDashed = edge.label === "try again" || edge.label === "resend";
    const edgeGroup = [];
    edgeGroup.push(el("path", {
      d: route.pathData,
      fill: "none",
      stroke: edge.style?.stroke ?? theme.edge.stroke,
      "stroke-width": theme.edge.strokeWidth,
      "marker-end": "url(#fs-arrow)",
      class: "fs-edge-path",
      ...isDashed ? { "stroke-dasharray": "6,3" } : {}
    }));
    const labelText = edge.label ?? edge.condition;
    if (labelText) {
      const lx = route.labelPosition.x;
      const ly = route.labelPosition.y;
      const lblWidth = labelText.length * 7 + 12;
      edgeGroup.push(el("rect", {
        x: lx - lblWidth / 2,
        y: ly - 9,
        width: lblWidth,
        height: 18,
        rx: 4,
        fill: "#ffffff",
        stroke: "none",
        opacity: 0.9
      }));
      edgeGroup.push(el("text", {
        x: lx,
        y: ly,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        "font-family": theme.edge.labelFont.family,
        "font-size": theme.edge.labelFont.size,
        "font-weight": edge.condition ? 600 : theme.edge.labelFont.weight,
        fill: edge.condition ? theme.shapes.decision.textColor ?? theme.edge.labelFont.color : theme.edge.labelFont.color,
        "font-style": !edge.condition && edge.label ? "italic" : "normal",
        class: "fs-edge-label"
      }, labelText));
    }
    return el("g", {
      class: "fs-edge",
      "data-from": edge.from,
      "data-to": edge.to
    }, ...edgeGroup);
  });
  return el("g", { class: "fs-edges" }, ...edgeEls);
}
function renderNodes(doc, theme) {
  const nodeEls = [];
  for (const [_2, node] of doc.nodes) {
    nodeEls.push(renderNode(node, theme));
  }
  return el("g", { class: "fs-nodes" }, ...nodeEls);
}
function calculateBounds(doc, padding) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [_2, node] of doc.nodes) {
    if (node.x === undefined || node.y === undefined)
      continue;
    const hw = (node.width ?? 180) / 2;
    const hh = (node.height ?? 44) / 2;
    minX = Math.min(minX, node.x - hw);
    minY = Math.min(minY, node.y - hh);
    maxX = Math.max(maxX, node.x + hw);
    maxY = Math.max(maxY, node.y + hh);
  }
  for (const group of doc.groups) {
    if (group.x === undefined || group.y === undefined)
      continue;
    const gw = (group.width ?? 200) / 2;
    const gh = (group.height ?? 300) / 2;
    minX = Math.min(minX, group.x - gw);
    minY = Math.min(minY, group.y - gh);
    maxX = Math.max(maxX, group.x + gw);
    maxY = Math.max(maxY, group.y + gh);
  }
  for (const lane of doc.lanes) {
    if (lane.x === undefined || lane.y === undefined)
      continue;
    const lw = (lane.width ?? 260) / 2;
    const lh = (lane.height ?? 400) / 2;
    const headerW = 120;
    minX = Math.min(minX, lane.x - lw - headerW);
    minY = Math.min(minY, lane.y - lh);
    maxX = Math.max(maxX, lane.x + lw);
    maxY = Math.max(maxY, lane.y + lh);
  }
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 400;
    maxY = 300;
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding
  };
}
// src/themes/clean.ts
var cleanTheme = {
  name: "clean",
  background: "#ffffff",
  node: {
    fill: "#ffffff",
    stroke: "#d0d0d6",
    strokeWidth: 1.2,
    borderRadius: 6,
    shadow: true,
    font: { family: "'Inter', system-ui, sans-serif", size: 13, color: "#28251D", weight: 500 }
  },
  edge: {
    stroke: "#5a5a62",
    strokeWidth: 1.5,
    arrowSize: 10,
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 11, color: "#6a6a72", weight: 500 }
  },
  shapes: {
    start: { fill: "#d4edda", stroke: "#4caf50", textColor: "#2e7d32" },
    end: { fill: "#eceff1", stroke: "#78909c", textColor: "#37474f" },
    decision: { fill: "#fff8e1", stroke: "#f9a825", textColor: "#e65100" },
    process: { fill: "#ffffff", stroke: "#d0d0d6" },
    subprocess: { fill: "#f5f5f5", stroke: "#9e9e9e" },
    io: { fill: "#e3f2fd", stroke: "#42a5f5", textColor: "#1565c0" },
    data: { fill: "#e8eaf6", stroke: "#5c6bc0", textColor: "#283593" },
    circle: { fill: "#f3e5f5", stroke: "#ab47bc", textColor: "#6a1b9a" },
    note: { fill: "#fffde7", stroke: "#fdd835", textColor: "#f57f17" },
    manual: { fill: "#fce4ec", stroke: "#ef5350", textColor: "#c62828" },
    delay: { fill: "#f3e5f5", stroke: "#9c27b0", textColor: "#6a1b9a" }
  },
  group: {
    fills: ["#eff6ff", "#f0fdf4", "#faf5ff", "#fef3c7"],
    strokes: ["#93c5fd", "#86efac", "#c4b5fd", "#fcd34d"],
    headerFills: ["#dbeafe", "#dcfce7", "#ede9fe", "#fef08a"],
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 12, color: "#1e40af", weight: 700 }
  },
  lane: {
    fills: ["#f8fafc", "#fefce8", "#f0fdf4", "#faf5ff", "#fff1f2"],
    strokes: ["#cbd5e1", "#fde047", "#86efac", "#c4b5fd", "#fda4af"],
    headerFills: ["#e2e8f0", "#fef08a", "#bbf7d0", "#ddd6fe", "#fecdd3"],
    headerWidth: 120,
    dividerStroke: "#cbd5e1",
    dividerDash: "4,3",
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 12, color: "#334155", weight: 700 }
  }
};
// src/index.ts
function render(source, options = {}) {
  const doc = parse(source);
  layoutDocument(doc);
  const routes = routeEdges(doc);
  return renderSVG(doc, routes, {
    theme: options.theme ?? cleanTheme,
    padding: options.padding ?? 40
  });
}
export {
  routeEdges as route,
  renderSVG,
  render,
  parse,
  layoutDocument as layout,
  cleanTheme
};
