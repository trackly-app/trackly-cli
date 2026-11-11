'use strict';

// Compares the npm family registry (mcp/tool-families.js) with close-ai's
// src/mcp/tool-families.ts (close-ai #3619, KTD11). The close-ai file keeps the
// literal shapes `defineFamily('<id>', '<label>', { ... })` and
// `name: family('<id>', '<action>'),`, so it is read from its AST, never executed.
//
// Used by test/tool-families.test.js (when TRACKLY_BACKEND_DIR is set) and by
// the backend mode of scripts/verify-hosted-contract.js.
//
//   TRACKLY_BACKEND_DIR=/path/to/close-ai node scripts/verify-tool-families.js

const fs = require('node:fs');
const path = require('node:path');
const babelParser = require('@babel/parser');
const local = require('../mcp/tool-families');

const BACKEND_REGISTRY = path.join('src', 'mcp', 'tool-families.ts');

function stringValue(node, where) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  throw new Error(`${where} must be a string literal`);
}

function unwrap(node) {
  let current = node;
  while (current && ['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(current.type)) {
    current = current.expression;
  }
  return current;
}

/** The argument of Object.freeze(...) around an exported const, or the value itself. */
function frozenValue(node) {
  const value = unwrap(node);
  if (value?.type === 'CallExpression' && value.callee?.type === 'MemberExpression'
    && value.callee.object?.name === 'Object' && value.callee.property?.name === 'freeze') {
    return unwrap(value.arguments[0]);
  }
  return value;
}

function exportedConst(ast, name) {
  for (const statement of ast.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id?.name === name) return frozenValue(declarator.init);
    }
  }
  throw new Error(`${BACKEND_REGISTRY} must declare ${name}`);
}

/** Parse close-ai's registry into the same plain shape the npm mirror exposes. */
function readBackendRegistry(source) {
  const ast = babelParser.parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const familiesNode = exportedConst(ast, 'TOOL_FAMILIES');
  if (familiesNode?.type !== 'ArrayExpression') throw new Error('TOOL_FAMILIES must be an array literal');
  const families = familiesNode.elements.map((element, index) => {
    const where = `TOOL_FAMILIES[${index}]`;
    if (element?.type !== 'CallExpression' || element.callee?.name !== 'defineFamily') {
      throw new Error(`${where} must be defineFamily(...)`);
    }
    const [idNode, labelNode, optionsNode] = element.arguments;
    const id = stringValue(idNode, `${where} id`);
    const label = stringValue(labelNode, `${where} label`);
    const options = {};
    for (const property of optionsNode?.properties || []) {
      options[property.key.name ?? property.key.value] = stringValue(property.value, `${where}.${property.key.name}`);
    }
    return {
      id,
      label,
      heading: options.heading ?? label,
      tag: options.tag ?? `[${label}]`,
      sentence: options.sentence ?? null,
    };
  });
  const entriesNode = exportedConst(ast, 'TOOL_FAMILY_ENTRIES');
  if (entriesNode?.type !== 'ObjectExpression') throw new Error('TOOL_FAMILY_ENTRIES must be an object literal');
  const entries = {};
  for (const property of entriesNode.properties) {
    const name = property.key?.name ?? property.key?.value;
    const call = unwrap(property.value);
    if (call?.type !== 'CallExpression' || call.callee?.name !== 'family' || call.arguments.length !== 2) {
      throw new Error(`TOOL_FAMILY_ENTRIES.${name} must be family('<id>', '<action>')`);
    }
    entries[name] = [stringValue(call.arguments[0], `${name} family`), stringValue(call.arguments[1], `${name} action`)];
  }
  return { families, entries };
}

/** Differences between the npm mirror and close-ai's registry; empty when they agree. */
function compareWithBackend(source) {
  const backend = readBackendRegistry(source);
  const errors = [];
  const localFamilies = local.TOOL_FAMILIES.map(({ id, label, heading, tag, sentence }) => ({ id, label, heading, tag, sentence }));
  if (JSON.stringify(localFamilies) !== JSON.stringify(backend.families)) {
    errors.push(`families differ:\n  npm:      ${JSON.stringify(localFamilies)}\n  close-ai: ${JSON.stringify(backend.families)}`);
  }
  const localOnly = new Set(local.LOCAL_ONLY_TOOL_NAMES);
  const localNames = Object.keys(local.TOOL_ACTIONS);
  for (const name of Object.keys(backend.entries)) {
    if (!Object.hasOwn(local.TOOL_ACTIONS, name)) {
      errors.push(`${name} is in close-ai's registry but not in mcp/tool-families.js`);
      continue;
    }
    const [family, action] = local.TOOL_ACTIONS[name];
    const [backendFamily, backendAction] = backend.entries[name];
    if (family !== backendFamily || action !== backendAction) {
      errors.push(`${name}: npm ${family} "${action}", close-ai ${backendFamily} "${backendAction}"`);
    }
  }
  for (const name of localNames) {
    if (!Object.hasOwn(backend.entries, name) && !localOnly.has(name)) {
      errors.push(`${name} is in mcp/tool-families.js but neither in close-ai's registry nor LOCAL_ONLY_TOOL_NAMES`);
    }
  }
  // Shared names keep close-ai's order, so docs and catalogs group identically.
  const sharedOrder = localNames.filter((name) => Object.hasOwn(backend.entries, name));
  const backendOrder = Object.keys(backend.entries).filter((name) => Object.hasOwn(local.TOOL_ACTIONS, name));
  if (JSON.stringify(sharedOrder) !== JSON.stringify(backendOrder)) errors.push('shared tool names are in a different order');
  return errors;
}

function verifyBackendDir(backendDir) {
  const file = path.join(backendDir, BACKEND_REGISTRY);
  if (!fs.existsSync(file)) return [`${file} does not exist; point TRACKLY_BACKEND_DIR at a close-ai checkout that has the family registry`];
  return compareWithBackend(fs.readFileSync(file, 'utf8'));
}

if (require.main === module) {
  const backendDir = process.env.TRACKLY_BACKEND_DIR;
  if (!backendDir) {
    console.error('Set TRACKLY_BACKEND_DIR to a close-ai checkout.');
    process.exit(2);
  }
  const errors = verifyBackendDir(path.resolve(backendDir));
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.log(errors.length === 0 ? 'Tool families match close-ai.' : `Tool families differ from close-ai in ${errors.length} place(s).`);
  process.exitCode = errors.length === 0 ? 0 : 1;
}

module.exports = { BACKEND_REGISTRY, compareWithBackend, readBackendRegistry, verifyBackendDir };
