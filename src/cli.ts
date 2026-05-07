#!/usr/bin/env bun
/**
 * FlowScript CLI
 * 
 * Usage:
 *   flowscript render input.flow -o output.svg
 *   flowscript render input.flow -o output.svg --theme dark
 *   echo "A -> B -> C" | flowscript render --stdin -o output.svg
 *   flowscript lint input.flow
 */

import { readFileSync, writeFileSync } from 'fs';
import { render, parse } from './index.js';

const args = process.argv.slice(2);

function usage(): void {
  console.log(`
FlowScript — Type it. See it. Ship it.

Usage:
  flowscript render <input.flow> -o <output.svg>   Render a diagram
  flowscript render --stdin -o <output.svg>         Read from stdin
  flowscript lint <input.flow>                      Validate syntax
  flowscript mcp                                    Start MCP server (stdio)
  flowscript --help                                 Show this help

Options:
  -o, --output <file>    Output file path (format inferred from extension)
  --theme <name>         Theme name (default: clean)
  --padding <px>         Padding around diagram (default: 40)

Examples:
  flowscript render flow.fs -o diagram.svg
  echo "#start A\\n  B\\n  #end C" | flowscript render --stdin -o out.svg
  flowscript mcp                                    # for Claude Desktop integration
`);
}

function main(): void {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const command = args[0];

  if (command === 'render') {
    cmdRender();
  } else if (command === 'lint') {
    cmdLint();
  } else if (command === 'mcp') {
    // Delegate to the MCP server entry point (dynamic import keeps the
    // MCP SDK out of the critical path for render/lint commands).
    import('./mcp-server.js').catch(err => {
      console.error('Failed to start MCP server:', err.message);
      process.exit(1);
    });
  } else {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
}

function cmdRender(): void {
  const useStdin = args.includes('--stdin');
  let inputFile: string | null = null;
  let outputFile: string | null = null;
  let padding = 40;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      outputFile = args[++i];
    } else if (args[i] === '--padding') {
      padding = parseInt(args[++i], 10);
    } else if (args[i] === '--stdin') {
      // handled above
    } else if (!args[i].startsWith('-')) {
      inputFile = args[i];
    }
  }

  if (!outputFile) {
    console.error('Error: output file required (-o <file>)');
    process.exit(1);
  }

  let source: string;
  if (useStdin) {
    source = readFileSync('/dev/stdin', 'utf-8');
  } else if (inputFile) {
    source = readFileSync(inputFile, 'utf-8');
  } else {
    console.error('Error: input file or --stdin required');
    process.exit(1);
    return;
  }

  try {
    const svg = render(source, { padding });
    writeFileSync(outputFile, svg, 'utf-8');
    console.log(`✓ Rendered to ${outputFile}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function cmdLint(): void {
  const inputFile = args[1];
  if (!inputFile) {
    console.error('Error: input file required');
    process.exit(1);
  }

  const source = readFileSync(inputFile, 'utf-8');
  try {
    const doc = parse(source);
    const nodeCount = doc.nodes.size;
    const edgeCount = doc.edges.length;
    const groupCount = doc.groups.length;
    console.log(`✓ Valid FlowScript`);
    console.log(`  ${nodeCount} nodes, ${edgeCount} edges, ${groupCount} groups`);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
