'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
function assertExactHostedSourceSha256(source, expected, label) { assert.equal(crypto.createHash('sha256').update(source).digest('hex'), expected, label + ' must preserve its exact reviewed source bytes'); }
// Candidate-only security sources introduced after the immutable checked-in
// hosted fixture. Keep these separate so historical fixture verification stays
// independent while coordinated verification locks every new trust boundary.
const HOSTED_RESUME_SECURITY_SOURCE_SHA256 = Object.freeze({
  'src/mcp/plugin-router.ts': '1dd7a737d922e3f3f4ab1212ac01286bf356dc9f2b78cf991abc3dc91d69852f',
  'src/mcp/plugin-resume-capability.ts': '944bcb942c9a537e8fa0d90991aab49b1e12582d05091ea5ace4776d2ddca322',
  'src/mcp/plugin-resume-document.ts': '1ee57a9948aa296cd1b75dac814386609cf0e02b7d02dbcb9f096ddce98068db',
  'src/mcp/plugin-resume-router.ts': '9f5d38830b304bdfd5813101851f101eeaa3d879c3ab70ac9d29c4b97dd2a434',
  'src/mcp/plugin-resume-store.ts': '9998e79d2a27112ce9cfb4d61f0b9fbf90ebfa658d2aecee87b492c3c7ed1fab',
  'src/services/application-profile/plugin-resume-attachment.ts': '7c0bb50d33913987fdebfd135c5bc5fcf89d16325eeb38c5c5ef8ded6b001f9b',
  'src/index.ts': '8e10127dedb8d14d3b69eebe9fa16bc3b565c7d2745cdb54eae0b52e66f03279',
});

function assertHostedResumeSecuritySourceSnapshots(
  sources,
  sourcePaths = {},
  expected = HOSTED_RESUME_SECURITY_SOURCE_SHA256,
) {
  assert.deepEqual(
    Object.keys(sources).sort(),
    Object.keys(expected).sort(),
    'Hosted resume verification must inspect every locked security source exactly once',
  );
  for (const [relativePath, expectedSha256] of Object.entries(expected)) {
    assert.equal(typeof sources[relativePath], 'string', relativePath + ' source must be loaded');
    assertExactHostedSourceSha256(
      sources[relativePath],
      expectedSha256,
      sourcePaths[relativePath] || relativePath,
    );
  }
}

function createResumeParserVerifier({ activeNamedDefinitionAst, staticMemberName, parseFullSource, canonicalSchemaAst }) {
function assertResumeGlobalParserCarveout(source, sourcePath) {
  const factory = activeNamedDefinitionAst(source, 'createApp', sourcePath);
  const candidates = factory.body.body.filter((statement) => {
    const call = statement.type === 'ExpressionStatement' ? statement.expression : null;
    const middleware = call?.type === 'CallExpression' ? call.arguments[0] : null;
    if (call?.callee?.type !== 'MemberExpression'
        || call.callee.object?.type !== 'Identifier'
        || call.callee.object.name !== 'app'
        || staticMemberName(call.callee) !== 'use'
        || call.arguments.length !== 1
        || middleware?.type !== 'ArrowFunctionExpression'
        || middleware.body?.type !== 'BlockStatement') return false;
    return middleware.body.body.some((child) => (
      child.type === 'VariableDeclaration'
      && child.declarations.some((declaration) => declaration.id?.type === 'Identifier'
        && declaration.id.name === 'normalizedPath')
    ));
  });
  assert.equal(candidates.length, 2, sourcePath + ' must have the reviewed JSON and URL-encoded parsers');
  for (const [index, candidate] of candidates.entries()) {
  const middlewareBody = candidate.expression.arguments[0].body.body;
  const normalization = middlewareBody.find((statement) => statement.type === 'VariableDeclaration'
    && statement.declarations.some((declaration) => declaration.id?.name === 'normalizedPath'));
  const expectedNormalization = parseFullSource(
    String.raw`const normalizedPath = (req.path.replace(/\/+$/, '') || '/').toLowerCase();`,
    'expected resume route normalization',
  ).program.body[0];
  assert.deepEqual(canonicalSchemaAst(normalization), canonicalSchemaAst(expectedNormalization),
    sourcePath + ' both parsers must normalize trailing slash and case before route matching');
  const expectedCarveout = parseFullSource(
    "function expected() { if (req.method === 'POST' && normalizedPath === '/api/plugin/trackly/mcp/resume') return next(); }",
    'expected resume parser carve-out',
  ).program.body[0].body.body[0];
  assert.equal(
    middlewareBody.filter((statement) => JSON.stringify(canonicalSchemaAst(statement))
      === JSON.stringify(canonicalSchemaAst(expectedCarveout))).length,
    1,
    sourcePath + ' must bypass the global parser only for the exact POST resume document route',
  );
  const expectedFinalStatement = parseFullSource(
    index === 0 ? "function expected() { return express.json({ limit: '10mb' })(req, res, next); }" : "function expected() { return express.urlencoded({ extended: false })(req, res, next); }",
    'expected global JSON parser return',
  ).program.body[0].body.body[0];
  assert.deepEqual(
    canonicalSchemaAst(middlewareBody.at(-1)),
    canonicalSchemaAst(expectedFinalStatement),
    sourcePath + ' global parser must remain the final fallback after narrow carve-outs',
  );
  }
}
 return assertResumeGlobalParserCarveout;
}
function verifyResumeToolContract({ hostedPluginSource, hostedPluginSourcePath, pluginToolRegistration, staticBabelObjectProperties, assertBabelPropertyExpression, assertDescriptorUsesTopLevelBinding, schemaObjectPropertyAsts, assertExactSchemaProperties, canonicalSchemaAst, parseFullSource }) {
function assertDirectResumeHandlerAst(registration, expected, label) {
 assert.equal(registration.call.arguments.length, 3);
 assert.deepEqual(canonicalSchemaAst(registration.call.arguments[2]), canonicalSchemaAst(parseFullSource('const handler = ' + expected, label).program.body[0].declarations[0].init), label + ' resume handler must preserve component-only capability semantics');
}
const resumeRegistration = pluginToolRegistration('trackly_prepare_resume_artifact');
const resumeDescriptorProperties = staticBabelObjectProperties(
  resumeRegistration.call.arguments[1],
  'trackly_prepare_resume_artifact descriptor',
);
assertBabelPropertyExpression(
  resumeDescriptorProperties,
  'inputSchema',
  "z.object({ operation: z.literal('preview').optional() }).strict()",
  'trackly_prepare_resume_artifact descriptor',
);
assertDescriptorUsesTopLevelBinding(
  hostedPluginSource,
  resumeRegistration,
  'outputSchema',
  'resumeOutputSchema',
  hostedPluginSourcePath,
);
const resumeOutputProperties = schemaObjectPropertyAsts(
  hostedPluginSource,
  'resumeOutputSchema',
  hostedPluginSourcePath,
);
const resumeOutputContract = {
  view: "z.literal('resume')",
  success: 'z.boolean()',
  requiresLocalAgentOrManualUpload: 'z.literal(true)',
  automaticEmployerAttachment: 'z.literal(false)',
  noSubmit: 'z.literal(true)',
  nextAction: 'z.string()',
  privacy: 'z.string()',
  document: `z.object({
    resumeId: z.number().int().positive(),
    filename: z.string(),
    mimeType: z.string(),
    sha256: z.string().regex(SHA256),
    sizeBytes: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  }).strict().optional()`,
};
assertExactSchemaProperties(resumeOutputProperties, resumeOutputContract, 'resumeOutputSchema');
assertDirectResumeHandlerAst(
  resumeRegistration,
  `async ({ operation }) => {
    try {
      if (operation === 'preview') {
        if (!prepareResume) throw new Error('Resume preview is unavailable on this host');
        const { openUrl, ...document } = await prepareResume();
        return { ...resultContent({ view: 'resume' as const, success: true, requiresLocalAgentOrManualUpload: true as const,
          automaticEmployerAttachment: false as const, noSubmit: true as const, document,
          nextAction: 'Open and review the original resume. Obtain explicit approval of this exact document before any employer upload. Opening the preview is not approval.',
          privacy: 'Private document access is delivered only to the preview component. No employer upload has occurred.' }, true),
          _meta: { 'trackly/resumeOpenUrl': openUrl } };
      }
      return resultContent({
      view: 'resume' as const,
      success: true,
      requiresLocalAgentOrManualUpload: true,
      automaticEmployerAttachment: false as const,
      noSubmit: true as const,
      nextAction: 'Choose or upload the resume manually, attach it to the visible Resume or CV field, then verify the visible filename before continuing.' as const,
      privacy: 'No resume bytes, file identifiers, filenames, download URLs, tokens, or local paths were returned or stored.' as const,
      }, true);
    } catch (error) { return errorContent(error, 'Failed to prepare resume handoff'); }
  }`,
  hostedPluginSourcePath,
);

}

module.exports = { HOSTED_RESUME_SECURITY_SOURCE_SHA256, assertHostedResumeSecuritySourceSnapshots, createResumeParserVerifier, verifyResumeToolContract };
