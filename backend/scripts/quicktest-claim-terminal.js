/**
 * Quick manual regression test for /api/terminals/claim.
 *
 * Usage:
 *   node scripts/quicktest-claim-terminal.js --base http://127.0.0.1:3333 --code 306471 --identifier A1B2C3 --name "Maquininha 01"
 *
 * Expected:
 * - First call: 200 with { terminalId, apiKey }
 * - Second call (same code + same identifier): 200 idempotent (same apiKey)
 * - Second call (same code + different identifier): 409 with code CODE_ALREADY_USED_BY_OTHER_TERMINAL
 */

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const base = (getArg('--base') || process.env.API_BASE || 'http://127.0.0.1:3333').replace(/\/$/, '');
  const code = getArg('--code') || '';
  const identifier = getArg('--identifier') || '';
  const name = getArg('--name') || 'Maquininha';
  const differentIdentifier = getArg('--identifier2') || `${identifier}_DIFF`;

  if (!code) {
    console.error('Missing --code');
    process.exit(2);
  }
  if (!identifier) {
    console.error('Missing --identifier');
    process.exit(2);
  }

  const url = `${base}/api/terminals/claim`;

  async function call(body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  console.log('1) claim (expected 200)');
  const r1 = await call({ code, identifier, name });
  console.log(r1);

  console.log('2) claim again same identifier (expected 200 idempotent)');
  const r2 = await call({ code, identifier, name });
  console.log(r2);

  console.log('3) claim again different identifier (expected 409 conflict)');
  const r3 = await call({ code, identifier: differentIdentifier, name });
  console.log(r3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

