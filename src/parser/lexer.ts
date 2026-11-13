/**
 * FlowScript Lexer — tokenizes raw text into a stream of typed tokens.
 * 
 * Handles: frontmatter, directives, shape keywords, connections,
 * labels, style blocks, comments, and indentation.
 */

export type TokenType =
  | 'FRONTMATTER_DELIM'  // ---
  | 'FRONTMATTER_LINE'   // key: value inside frontmatter
  | 'DIRECTIVE'           // @theme, @direction, etc.
  | 'SHAPE_KEYWORD'       // #start, #end, #decision, etc.
  | 'ARROW'               // ->
  | 'RETRY_ARROW'         // ~> (dashed retry/loop-back edge)
  | 'COLON'               // :
  | 'COMMA'               // ,
  | 'LBRACE'              // {
  | 'RBRACE'              // }
  | 'STRING'              // "quoted string"
  | 'CONDITION'           // 'single-quoted condition' (unambiguous branch label)
  | 'TEXT'                // unquoted text (node label, etc.)
  | 'NEWLINE'             // line break
  | 'INDENT'              // leading whitespace at start of line
  | 'COMMENT'             // // comment
  | 'AT_ID'               // @identifier
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

const SHAPE_KEYWORDS = new Set([
  'start', 'end', 'decision', 'process', 'subprocess',
  'io', 'data', 'circle', 'note', 'group', 'lane', 'manual', 'delay',
]);

const DIRECTIVE_KEYS = new Set([
  'theme', 'direction', 'spacing', 'font', 'routing', 'corner-radius',
  'connections', 'line-jumps', 'layout',
]);

/**
 * Tokenize a FlowScript source string.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split('\n');
  let inFrontmatter = false;
  let frontmatterSeen = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum];
    const line = lineNum + 1; // 1-based

    // Frontmatter delimiters
    if (rawLine.trim() === '---') {
      tokens.push({ type: 'FRONTMATTER_DELIM', value: '---', line, col: 1 });
      if (!frontmatterSeen) {
        inFrontmatter = true;
        frontmatterSeen = true;
      } else {
        inFrontmatter = false;
      }
      tokens.push({ type: 'NEWLINE', value: '\n', line, col: rawLine.length + 1 });
      continue;
    }

    // Inside frontmatter — everything is a key: value pair
    if (inFrontmatter) {
      tokens.push({ type: 'FRONTMATTER_LINE', value: rawLine.trim(), line, col: 1 });
      tokens.push({ type: 'NEWLINE', value: '\n', line, col: rawLine.length + 1 });
      continue;
    }

    // Emit indentation
    const indentMatch = rawLine.match(/^(\s+)/);
    if (indentMatch) {
      tokens.push({ type: 'INDENT', value: indentMatch[1], line, col: 1 });
    }

    const trimmed = rawLine.trim();

    // Skip empty lines
    if (trimmed === '') {
      tokens.push({ type: 'NEWLINE', value: '\n', line, col: 1 });
      continue;
    }

    // Comments
    if (trimmed.startsWith('//')) {
      tokens.push({ type: 'COMMENT', value: trimmed.slice(2).trim(), line, col: rawLine.indexOf('//') + 1 });
      tokens.push({ type: 'NEWLINE', value: '\n', line, col: rawLine.length + 1 });
      continue;
    }

    // Tokenize the rest of the line
    tokenizeLine(trimmed, line, rawLine.indexOf(trimmed) + 1, tokens);
    tokens.push({ type: 'NEWLINE', value: '\n', line, col: rawLine.length + 1 });
  }

  tokens.push({ type: 'EOF', value: '', line: lines.length + 1, col: 1 });
  return tokens;
}

/**
 * Tokenize a single non-empty, trimmed line.
 */
function tokenizeLine(line: string, lineNum: number, baseCol: number, tokens: Token[]): void {
  let pos = 0;

  function col(): number {
    return baseCol + pos;
  }

  function peek(): string {
    return line[pos] ?? '';
  }

  function remaining(): string {
    return line.slice(pos);
  }

  function skipSpaces(): void {
    while (pos < line.length && (line[pos] === ' ' || line[pos] === '\t')) {
      pos++;
    }
  }

  while (pos < line.length) {
    const loopStart = pos;
    skipSpaces();
    if (pos >= line.length) break;

    const c = col();

    // Directive: @theme, @direction, etc.
    if (peek() === '@') {
      pos++; // skip @
      const wordStart = pos;
      while (pos < line.length && /[a-zA-Z0-9_-]/.test(line[pos])) pos++;
      const word = line.slice(wordStart, pos);

      if (DIRECTIVE_KEYS.has(word)) {
        // It's a directive — rest of line (after whitespace) is the value
        skipSpaces();
        const valueStart = pos;
        const value = line.slice(valueStart).trim();
        tokens.push({ type: 'DIRECTIVE', value: `${word} ${value}`, line: lineNum, col: c });
        pos = line.length; // consume rest of line
      } else {
        // It's a node ID reference: @myId
        tokens.push({ type: 'AT_ID', value: word, line: lineNum, col: c });
      }
      continue;
    }

    // Shape keyword: #start, #decision, etc.
    if (peek() === '#') {
      pos++; // skip #
      const wordStart = pos;
      while (pos < line.length && /[a-zA-Z]/.test(line[pos])) pos++;
      const word = line.slice(wordStart, pos).toLowerCase();

      if (SHAPE_KEYWORDS.has(word)) {
        tokens.push({ type: 'SHAPE_KEYWORD', value: word, line: lineNum, col: c });
      } else {
        // Not a recognized keyword — treat as text
        pos = wordStart - 1; // back up to #
        // Fall through to text parsing below
        const text = readTextSegment(line, pos, lineNum);
        tokens.push({ type: 'TEXT', value: text.value, line: lineNum, col: c });
        pos = text.endPos;
      }
      continue;
    }

    // Arrow: ->
    if (peek() === '-' && line[pos + 1] === '>') {
      tokens.push({ type: 'ARROW', value: '->', line: lineNum, col: c });
      pos += 2;
      continue;
    }

    // Retry arrow: ~> (dashed loop-back / retry edge)
    if (peek() === '~' && line[pos + 1] === '>') {
      tokens.push({ type: 'RETRY_ARROW', value: '~>', line: lineNum, col: c });
      pos += 2;
      continue;
    }

    // Colon
    if (peek() === ':') {
      tokens.push({ type: 'COLON', value: ':', line: lineNum, col: c });
      pos++;
      continue;
    }

    // Comma
    if (peek() === ',') {
      tokens.push({ type: 'COMMA', value: ',', line: lineNum, col: c });
      pos++;
      continue;
    }

    // Style block open
    if (peek() === '{') {
      tokens.push({ type: 'LBRACE', value: '{', line: lineNum, col: c });
      pos++;
      continue;
    }

    // Style block close
    if (peek() === '}') {
      tokens.push({ type: 'RBRACE', value: '}', line: lineNum, col: c });
      pos++;
      continue;
    }

    // Quoted string
    if (peek() === '"') {
      pos++; // skip opening quote
      const strStart = pos;
      while (pos < line.length && line[pos] !== '"') {
        if (line[pos] === '\\') pos++; // skip escaped char
        pos++;
      }
      const str = line.slice(strStart, pos);
      if (pos < line.length) pos++; // skip closing quote
      tokens.push({ type: 'STRING', value: str, line: lineNum, col: c });
      continue;
    }

    // Single-quoted condition: 'Yes', 'No', 'P1', etc.
    // Unambiguous condition delimiter — no colon required after it.
    if (peek() === "'") {
      pos++; // skip opening quote
      const strStart = pos;
      while (pos < line.length && line[pos] !== "'") {
        if (line[pos] === '\\') pos++; // skip escaped char
        pos++;
      }
      const str = line.slice(strStart, pos);
      if (pos < line.length) pos++; // skip closing quote
      tokens.push({ type: 'CONDITION', value: str, line: lineNum, col: c });
      continue;
    }

    // Comment: // starts a comment at line start or after whitespace
    // (skipSpaces has just run, so this position is one of those).
    if (peek() === '/' && line[pos + 1] === '/') {
      tokens.push({ type: 'COMMENT', value: line.slice(pos + 2).trim(), line: lineNum, col: c });
      pos = line.length;
      continue;
    }

    // Text segment: everything up to a special character
    const text = readTextSegment(line, pos, lineNum);
    if (text.value) {
      tokens.push({ type: 'TEXT', value: text.value, line: lineNum, col: c });
    }
    pos = text.endPos;

    // No-progress guard: a missed character must not freeze the tokenizer.
    if (pos <= loopStart) {
      pos++;
    }
  }
}

/**
 * Read a text segment until we hit a special character or end of line.
 * Special characters that terminate text: -> ~> : , { } " @ #
 *
 * Comment rule: // starts a comment only at line start or after
 * whitespace. // inside a token (http://example.com, a//b) stays
 * in the label. A URL scheme (://) does not terminate the token
 * at the colon, so the URL stays a single TEXT token.
 */
function readTextSegment(line: string, startPos: number, _lineNum: number): { value: string; endPos: number } {
  let pos = startPos;
  let text = '';

  while (pos < line.length) {
    const loopStart = pos;

    // Stop at special characters
    if (line[pos] === ',' || line[pos] === '{' || line[pos] === '}' || line[pos] === '"') break;

    // Colon terminates text unless it starts a URL scheme (://)
    if (line[pos] === ':') {
      if (line[pos + 1] === '/' && line[pos + 2] === '/') {
        text += '://';
        pos += 3;
      } else {
        break;
      }
    } else if (line[pos] === '-' && line[pos + 1] === '>') {
      break;
    } else if (line[pos] === '~' && line[pos + 1] === '>') {
      break;
    } else if (line[pos] === '@' && pos > startPos) {
      break;
    } else if (line[pos] === '#' && pos > startPos) {
      break;
    } else if (line[pos] === '/' && line[pos + 1] === '/') {
      // // starts a comment only at line start or after whitespace
      const afterWs = pos === 0 || line[pos - 1] === ' ' || line[pos - 1] === '\t';
      if (afterWs) break;
      text += '//';
      pos += 2;
    } else {
      text += line[pos];
      pos++;
    }

    // No-progress guard: force a one-character advance rather than stall.
    if (pos <= loopStart) {
      pos++;
    }
  }

  return { value: text.trim(), endPos: pos };
}
