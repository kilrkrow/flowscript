/**
 * FlowScript Parser — recursive descent parser that converts a token stream into an AST.
 * 
 * Handles:
 * - Frontmatter metadata
 * - Directives (@theme, @direction, etc.)
 * - Node declarations with shape keywords
 * - Explicit connections (->)
 * - Implicit sequential connections (indented lists)
 * - Groups (#group)
 * - Style overrides ({ fill: "...", ... })
 * - Edge labels ("label" or condition: label)
 * - @id node references
 */

import { tokenize, type Token, type TokenType } from './lexer.js';
import type {
  FlowDocument, FlowNode, FlowEdge, FlowGroup, FlowLane,
  Directive, ShapeType, StyleOverrides,
} from './ast.js';

export class ParseError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`Parse error at line ${line}, col ${col}: ${message}`);
    this.name = 'ParseError';
  }
}

/**
 * Parse a FlowScript source string into a FlowDocument AST.
 */
export function parse(source: string): FlowDocument {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parse();
}

class Parser {
  private pos = 0;
  private tokens: Token[];
  private doc: FlowDocument;
  private currentGroup: string | null = null;
  private currentLane: string | null = null;
  private implicitPrev: string | null = null;
  private nodeCounter = 0;
  private idMap = new Map<string, string>(); // @id -> generated node id

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.doc = {
      meta: {},
      directives: [],
      nodes: new Map(),
      edges: [],
      groups: [],
      lanes: [],
    };
  }

  parse(): FlowDocument {
    this.parseFrontmatter();
    this.parseBody();
    return this.doc;
  }

  // --- Token navigation ---

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: 'EOF', value: '', line: 0, col: 0 };
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new ParseError(`Expected ${type}, got ${t.type} ("${t.value}")`, t.line, t.col);
    }
    return this.advance();
  }

  private match(type: TokenType): Token | null {
    if (this.peek().type === type) return this.advance();
    return null;
  }

  private skipNewlines(): void {
    while (this.peek().type === 'NEWLINE' || this.peek().type === 'INDENT' || this.peek().type === 'COMMENT') {
      this.advance();
    }
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private isArrow(t: TokenType): boolean {
    return t === 'ARROW' || t === 'RETRY_ARROW';
  }

  // --- Frontmatter ---

  private parseFrontmatter(): void {
    this.skipNewlines();
    if (this.peek().type !== 'FRONTMATTER_DELIM') return;

    this.advance(); // skip opening ---
    this.match('NEWLINE');

    while (this.peek().type === 'FRONTMATTER_LINE') {
      const line = this.advance().value;
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        this.doc.meta[key] = value;
      }
      this.match('NEWLINE');
    }

    if (this.peek().type === 'FRONTMATTER_DELIM') {
      this.advance(); // skip closing ---
      this.match('NEWLINE');
    }
  }

  // --- Body ---

  private parseBody(): void {
    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd()) break;

      const token = this.peek();

      if (token.type === 'DIRECTIVE') {
        this.parseDirective();
      } else if (token.type === 'SHAPE_KEYWORD' && token.value === 'group') {
        this.parseGroup();
      } else if (token.type === 'SHAPE_KEYWORD' && token.value === 'lane') {
        this.parseLane();
      } else if (token.type === 'SHAPE_KEYWORD') {
        this.parseShapedNode();
      } else if (token.type === 'AT_ID') {
        this.parseAtIdLine();
      } else if (token.type === 'TEXT') {
        this.parseTextLine();
      } else {
        // Skip unknown tokens
        this.advance();
      }
    }
  }

  // --- Directives ---

  private parseDirective(): void {
    const token = this.advance();
    const spaceIdx = token.value.indexOf(' ');
    if (spaceIdx > 0) {
      const key = token.value.slice(0, spaceIdx);
      const value = token.value.slice(spaceIdx + 1).trim();
      this.doc.directives.push({ key, value });
    }
  }

  // --- Groups ---

  private parseGroup(): void {
    this.advance(); // skip #group keyword

    // Group label
    let label = '';
    if (this.peek().type === 'TEXT') {
      label = this.advance().value;
    } else if (this.peek().type === 'STRING') {
      label = this.advance().value;
    }

    const groupId = this.makeGroupId(label);
    const style = this.tryParseStyle();

    const group: FlowGroup = {
      id: groupId,
      label,
      children: [],
      style: style || undefined,
    };

    this.doc.groups.push(group);

    // Parse indented children on subsequent lines
    this.match('NEWLINE');
    const prevGroup = this.currentGroup;
    const prevImplicit = this.implicitPrev;
    this.currentGroup = groupId;
    this.implicitPrev = null;

    this.parseIndentedBlock(group);

    this.currentGroup = prevGroup;
    this.implicitPrev = prevImplicit;
  }

  /**
   * Parse indented lines as children of a group.
   * An indented block continues while lines start with INDENT tokens.
   */
  private parseIndentedBlock(group: FlowGroup): void {
    while (!this.isAtEnd()) {
      // Skip blank lines
      if (this.peek().type === 'NEWLINE') {
        this.advance();
        continue;
      }
      if (this.peek().type === 'COMMENT') {
        this.advance();
        continue;
      }

      // If next meaningful token is not indented, block is over
      if (this.peek().type !== 'INDENT') break;

      this.advance(); // consume INDENT

      const token = this.peek();

      if (token.type === 'SHAPE_KEYWORD') {
        const nodeId = this.parseShapedNode();
        if (nodeId) group.children.push(nodeId);
      } else if (token.type === 'AT_ID') {
        const nodeId = this.parseAtIdLine();
        if (nodeId) group.children.push(nodeId);
      } else if (token.type === 'TEXT') {
        const nodeId = this.parseTextLine();
        if (nodeId) group.children.push(nodeId);
      } else if (token.type === 'COMMENT' || token.type === 'NEWLINE') {
        this.advance();
      } else {
        break;
      }
    }
  }

  // --- Lanes ---

  private parseLane(): void {
    this.advance(); // skip #lane keyword

    // Lane label
    let label = '';
    if (this.peek().type === 'TEXT') {
      label = this.advance().value;
    } else if (this.peek().type === 'STRING') {
      label = this.advance().value;
    }

    const laneId = `lane_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const style = this.tryParseStyle();

    const lane: FlowLane = {
      id: laneId,
      label,
      children: [],
      style: style || undefined,
    };

    this.doc.lanes.push(lane);

    // Parse indented children on subsequent lines
    this.match('NEWLINE');
    const prevLane = this.currentLane;
    const prevImplicit = this.implicitPrev;
    this.currentLane = laneId;
    // Implicit chain is NOT reset — cross-lane edges are explicit only,
    // but within a lane we allow implicit chaining from wherever the caller left off.
    // Actually, per our design: implicit within lane, explicit across lanes.
    this.implicitPrev = null;

    this.parseLaneBlock(lane);

    this.currentLane = prevLane;
    this.implicitPrev = prevImplicit;
  }

  /**
   * Parse indented lines as children of a lane.
   * Identical structure to parseIndentedBlock but adds nodes to a FlowLane.
   */
  private parseLaneBlock(lane: FlowLane): void {
    while (!this.isAtEnd()) {
      if (this.peek().type === 'NEWLINE') {
        this.advance();
        continue;
      }
      if (this.peek().type === 'COMMENT') {
        this.advance();
        continue;
      }

      if (this.peek().type !== 'INDENT') break;
      this.advance(); // consume INDENT

      const token = this.peek();

      if (token.type === 'SHAPE_KEYWORD') {
        const nodeId = this.parseShapedNode();
        if (nodeId) lane.children.push(nodeId);
      } else if (token.type === 'AT_ID') {
        const nodeId = this.parseAtIdLine();
        if (nodeId) lane.children.push(nodeId);
      } else if (token.type === 'TEXT') {
        const nodeId = this.parseTextLine();
        if (nodeId) lane.children.push(nodeId);
      } else if (token.type === 'COMMENT' || token.type === 'NEWLINE') {
        this.advance();
      } else {
        break;
      }
    }
  }

  // --- Shaped nodes (#start, #decision, etc.) ---

  private parseShapedNode(): string | null {
    const shapeToken = this.advance();
    const shape = shapeToken.value as ShapeType;

    // Read label
    let label = '';
    if (this.peek().type === 'TEXT') {
      label = this.advance().value;
    } else if (this.peek().type === 'STRING') {
      label = this.advance().value;
    }

    if (!label) {
      label = shape.charAt(0).toUpperCase() + shape.slice(1);
    }

    const nodeId = this.ensureNode(label, shape);
    const style = this.tryParseStyle();
    if (style) {
      const node = this.doc.nodes.get(nodeId)!;
      node.style = { ...node.style, ...style };
    }

    // Check for inline connections: #start Begin -> Step A
    this.parseInlineConnections(nodeId);

    // Implicit sequential connection
    if (this.implicitPrev && shape !== 'start') {
      this.addEdge(this.implicitPrev, nodeId);
    }
    this.implicitPrev = nodeId;

    // Parse decision branches (indented -> yes: / -> no:)
    if (shape === 'decision') {
      this.parseDecisionBranches(nodeId);
    }

    return nodeId;
  }

  // --- Text lines (plain node labels) ---

  private parseTextLine(): string | null {
    const label = this.advance().value;
    if (!label) return null;

    // Check if this node already exists (i.e., this is a re-reference)
    const isExistingNode = this.nodeExistsByLabel(label);
    const nodeId = this.ensureNode(label, 'process');
    const style = this.tryParseStyle();
    if (style) {
      const node = this.doc.nodes.get(nodeId)!;
      node.style = { ...node.style, ...style };
    }

    const hasExplicitConnection = this.isArrow(this.peek().type);
    this.parseInlineConnections(nodeId);

    // Implicit sequential — add edge from previous node to this one.
    // Skip if: this is a re-referenced existing node with an explicit ->
    // (e.g., "Show Error Message -> Enter Email & Password: 'try again'")
    // In that case, the line is defining an explicit edge, not a sequential step.
    const isReferenceLine = isExistingNode && hasExplicitConnection;
    if (this.implicitPrev && !isReferenceLine) {
      this.addEdge(this.implicitPrev, nodeId);
    }
    
    // Break the implicit chain after explicit connection lines
    if (hasExplicitConnection) {
      this.implicitPrev = null;
    } else {
      this.implicitPrev = nodeId;
    }

    return nodeId;
  }

  // --- @id lines ---

  private parseAtIdLine(): string | null {
    const idToken = this.advance();
    const atId = idToken.value;

    // May be followed by a shape keyword, label, or connection
    let shape: ShapeType = 'process';
    if (this.peek().type === 'SHAPE_KEYWORD') {
      shape = this.advance().value as ShapeType;
    }

    let label = '';
    if (this.peek().type === 'TEXT') {
      label = this.advance().value;
    } else if (this.peek().type === 'STRING') {
      label = this.advance().value;
    }

    if (!label) label = atId;

    const nodeId = this.ensureNode(label, shape);
    this.idMap.set(atId, nodeId);

    const style = this.tryParseStyle();
    if (style) {
      const node = this.doc.nodes.get(nodeId)!;
      node.style = { ...node.style, ...style };
    }

    this.parseInlineConnections(nodeId);

    if (this.implicitPrev) {
      this.addEdge(this.implicitPrev, nodeId);
    }
    this.implicitPrev = nodeId;

    return nodeId;
  }

  // --- Inline connections ---

  /**
   * Parse -> Target, -> Target: "label" etc. on the same line after a node.
   * 
   * Patterns:
   *   -> TargetLabel
   *   -> TargetLabel: "edge label"
   *   -> condition: TargetLabel           (short word like yes/no before colon)
   *   -> condition: TargetLabel: "label"  (condition + target + label)
   *   -> @id
   *   -> #shape Label
   */
  private parseInlineConnections(fromId: string): void {
    while (this.isArrow(this.peek().type)) {
      const arrowTok = this.advance(); // consume -> or ~>
      const isRetry = arrowTok.type === 'RETRY_ARROW';

      let condition: string | undefined;
      let label: string | undefined;

      // Detect "condition:" pattern — only if TEXT is a short word (≤10 chars)
      // and is followed by COLON and then more content.
      // This avoids misinterpreting long node labels like "Enter Email & Password"
      // as conditions.
      const saved = this.pos;
      if (this.peek().type === 'TEXT') {
        const maybeCondition = this.peek().value;
        const isShortCondition = maybeCondition.length <= 10 && !this.nodeExistsByLabel(maybeCondition);

        if (isShortCondition) {
          this.advance();
          if (this.peek().type === 'COLON') {
            this.advance(); // consume :
            condition = maybeCondition;
          } else {
            this.pos = saved; // back up
          }
        }
      }

      // Target node
      let targetLabel = '';
      let targetShape: ShapeType = 'process';

      if (this.peek().type === 'AT_ID') {
        const refId = this.advance().value;
        const resolvedId = this.idMap.get(refId);
        if (resolvedId) {
          if (this.peek().type === 'COLON') {
            this.advance();
            if (this.peek().type === 'STRING') label = this.advance().value;
            else if (this.peek().type === 'TEXT') label = this.advance().value;
          }
          this.addEdge(fromId, resolvedId, label, condition, isRetry);
          this.implicitPrev = resolvedId;
          if (this.peek().type === 'COMMA') { this.advance(); continue; }
          return;
        }
        targetLabel = refId;
      } else if (this.peek().type === 'SHAPE_KEYWORD') {
        targetShape = this.advance().value as ShapeType;
        if (this.peek().type === 'TEXT') targetLabel = this.advance().value;
        else if (this.peek().type === 'STRING') targetLabel = this.advance().value;
        else targetLabel = targetShape.charAt(0).toUpperCase() + targetShape.slice(1);
      } else if (this.peek().type === 'TEXT') {
        targetLabel = this.advance().value;
      } else if (this.peek().type === 'STRING') {
        targetLabel = this.advance().value;
      }

      if (!targetLabel) continue;

      const targetId = this.ensureNode(targetLabel, targetShape);

      // Edge label after target: -> Target: "label"
      if (this.peek().type === 'COLON') {
        this.advance();
        if (this.peek().type === 'STRING') label = this.advance().value;
        else if (this.peek().type === 'TEXT') label = this.advance().value;
      }

      this.addEdge(fromId, targetId, label, condition, isRetry);
      this.implicitPrev = targetId;

      if (this.peek().type === 'COMMA') {
        this.advance();
        continue;
      }
      break;
    }
  }

  // --- Decision branches ---

  /**
   * Parse indented decision branches:
   *   -> yes: Target
   *   -> no: Target
   */
  private parseDecisionBranches(decisionId: string): void {
    // Peek ahead for indented arrows
    const saved = this.pos;

    // Skip newline
    while (this.peek().type === 'NEWLINE') this.advance();

    // Look for INDENT + ARROW pattern
    while (this.peek().type === 'INDENT') {
      const indentPos = this.pos;
      this.advance(); // skip indent

      if (this.isArrow(this.peek().type)) {
        const arrowTok = this.advance(); // consume -> or ~>
        const isRetry = arrowTok.type === 'RETRY_ARROW';

        // Condition: "yes:", "no:", etc.
        let condition: string | undefined;
        let label: string | undefined;

        if (this.peek().type === 'TEXT') {
          const maybeCondition = this.peek().value;
          const savedInner = this.pos;
          this.advance();
          if (this.peek().type === 'COLON') {
            this.advance();
            condition = maybeCondition;
          } else {
            this.pos = savedInner;
          }
        }

        // Target
        let targetLabel = '';
        let targetShape: ShapeType = 'process';

        if (this.peek().type === 'SHAPE_KEYWORD') {
          targetShape = this.advance().value as ShapeType;
          if (this.peek().type === 'TEXT') targetLabel = this.advance().value;
          else if (this.peek().type === 'STRING') targetLabel = this.advance().value;
        } else if (this.peek().type === 'TEXT') {
          targetLabel = this.advance().value;
        } else if (this.peek().type === 'STRING') {
          targetLabel = this.advance().value;
        } else if (this.peek().type === 'AT_ID') {
          const refId = this.advance().value;
          const resolvedId = this.idMap.get(refId);
          targetLabel = resolvedId ?? refId;
        }

        if (!targetLabel) continue;

        const targetId = this.ensureNode(targetLabel, targetShape);

        // Optional label after colon
        if (this.peek().type === 'COLON') {
          this.advance();
          if (this.peek().type === 'STRING') label = this.advance().value;
          else if (this.peek().type === 'TEXT') label = this.advance().value;
        }

        this.addEdge(decisionId, targetId, label, condition, isRetry);

        // Skip newlines for next branch
        while (this.peek().type === 'NEWLINE') this.advance();
      } else {
        // Not an arrow after indent — back up and stop
        this.pos = indentPos;
        break;
      }
    }
  }

  // --- Style blocks ---

  private tryParseStyle(): StyleOverrides | null {
    if (this.peek().type !== 'LBRACE') return null;
    this.advance(); // skip {

    const style: StyleOverrides = {};

    while (this.peek().type !== 'RBRACE' && !this.isAtEnd()) {
      // Expect key: value pairs
      if (this.peek().type === 'TEXT') {
        const key = this.advance().value;
        if (this.peek().type === 'COLON') {
          this.advance();
          let value = '';
          if (this.peek().type === 'STRING') value = this.advance().value;
          else if (this.peek().type === 'TEXT') value = this.advance().value;

          switch (key.toLowerCase()) {
            case 'fill': style.fill = value; break;
            case 'stroke': style.stroke = value; break;
            case 'text': style.text = value; break;
            case 'border': style.border = value; break;
          }
        }
      }
      if (this.peek().type === 'COMMA') this.advance();
      if (this.peek().type === 'NEWLINE') this.advance();
    }

    this.match('RBRACE');
    return Object.keys(style).length > 0 ? style : null;
  }

  // --- Helpers ---

  /**
   * Ensure a node exists in the document, creating it if needed.
   * Handles label-based deduplication and group-qualified names.
   */
  private ensureNode(label: string, shape: ShapeType): string {
    // Check if a node with this label already exists
    for (const [id, node] of this.doc.nodes) {
      if (node.label === label) {
        // Update shape if we're giving it a more specific one
        if (shape !== 'process' && node.shape === 'process') {
          node.shape = shape;
        }
        return id;
      }
    }

    // Create new node
    this.nodeCounter++;
    const id = `n${this.nodeCounter}`;
    const node: FlowNode = {
      id,
      label,
      shape,
      group: this.currentGroup ?? undefined,
      lane: this.currentLane ?? undefined,
    };
    this.doc.nodes.set(id, node);
    return id;
  }

  private addEdge(
    from: string, to: string,
    label?: string, condition?: string, retry?: boolean,
  ): void {
    // Avoid duplicate edges
    const exists = this.doc.edges.some(
      e => e.from === from && e.to === to && e.condition === condition
    );
    if (exists) return;

    // Backward compatibility: legacy magic-label retries (`try again`,
    // `resend`) implicitly mark the edge as a retry. New code should
    // prefer `~>` so retries don't depend on a specific label string.
    const isMagicRetry =
      label === 'try again' || label === 'resend';

    this.doc.edges.push({
      from,
      to,
      label,
      condition,
      retry: retry || isMagicRetry || undefined,
    });
  }

  private nodeExistsByLabel(label: string): boolean {
    for (const [_, node] of this.doc.nodes) {
      if (node.label === label) return true;
    }
    return false;
  }

  private makeGroupId(label: string): string {
    return `g_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }
}
