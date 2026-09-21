#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UPDATE_SIGNING_KEY_ID = 'mypwdmg-update-2026-01';

function parseArgs(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

function generateSigningKey(privateKeyPath, publicKeyPath, force = false) {
  if (!privateKeyPath || !publicKeyPath) {
    throw new Error('Both --private-key and --public-key paths are required.');
  }

  const privPath = path.resolve(privateKeyPath);
  const pubPath = path.resolve(publicKeyPath);

  if (!force && (fs.existsSync(privPath) || fs.existsSync(pubPath))) {
    throw new Error(`Signing key already exists at ${privPath}. Refusing to overwrite. Use --force to override.`);
  }

  fs.mkdirSync(path.dirname(privPath), { recursive: true });
  fs.mkdirSync(path.dirname(pubPath), { recursive: true });

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = spkiDer.subarray(spkiDer.length - 32);

  fs.writeFileSync(privPath, privPem, { mode: 0o600 });
  fs.writeFileSync(pubPath, pubPem);

  const pubB64 = rawPub.toString('base64');
  const fingerprint = crypto.createHash('sha256').update(rawPub).digest('hex');

  console.log(`Private key: ${privPath}`);
  console.log(`Public key:  ${pubPath}`);
  console.log(`UPDATE_PUBLIC_KEY_B64=${pubB64}`);
  console.log(`Raw public key SHA256=${fingerprint}`);
}

function signManifest(inputPath, outputPath, privateKeyPath) {
  if (!inputPath || !outputPath || !privateKeyPath) {
    throw new Error('--input, --output, and --private-key paths are required.');
  }

  const inPath = path.resolve(inputPath);
  const outPath = path.resolve(outputPath);
  const privPath = path.resolve(privateKeyPath);

  if (!fs.existsSync(inPath)) {
    throw new Error(`Input manifest not found: ${inPath}`);
  }
  if (!fs.existsSync(privPath)) {
    throw new Error(`Private key not found: ${privPath}`);
  }

  const raw = fs.readFileSync(inPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('Input manifest must be a JSON object');
  }

  const unsigned = { ...manifest };
  delete unsigned.signature;

  const canonicalBytes = Buffer.from(canonicalize(unsigned), 'utf8');
  const privPem = fs.readFileSync(privPath, 'utf8');
  const privateKey = crypto.createPrivateKey(privPem);

  const signature = crypto.sign(null, canonicalBytes, privateKey);

  manifest.signature = {
    algorithm: 'Ed25519',
    keyId: UPDATE_SIGNING_KEY_ID,
    value: signature.toString('base64')
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Signed update manifest: ${outPath}`);
}

function verifyManifest(inputPath, publicKeyPath) {
  if (!inputPath) {
    throw new Error('--input path is required.');
  }
  const inPath = path.resolve(inputPath);
  if (!fs.existsSync(inPath)) {
    throw new Error(`Input manifest not found: ${inPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const sigBlock = manifest.signature;
  if (!sigBlock || typeof sigBlock !== 'object') {
    throw new Error('Manifest is not signed');
  }

  if (sigBlock.algorithm !== 'Ed25519') {
    throw new Error(`Unsupported signature algorithm: ${sigBlock.algorithm}`);
  }

  const unsigned = { ...manifest };
  delete unsigned.signature;
  const canonicalBytes = Buffer.from(canonicalize(unsigned), 'utf8');
  const sigBytes = Buffer.from(sigBlock.value, 'base64');

  let publicKey;
  if (publicKeyPath && fs.existsSync(publicKeyPath)) {
    publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath, 'utf8'));
  } else {
    throw new Error('Public key path required for verification');
  }

  const verified = crypto.verify(null, canonicalBytes, publicKey, sigBytes);
  if (!verified) {
    throw new Error('Manifest signature verification FAILED');
  }
  console.log(`Verified update manifest: ${inPath}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  switch (command) {
    case 'generate-signing-key':
      generateSigningKey(args['private-key'], args['public-key'], Boolean(args.force));
      break;
    case 'sign-manifest':
      signManifest(args.input, args.output, args['private-key']);
      break;
    case 'verify-manifest':
      verifyManifest(args.input, args['public-key']);
      break;
    default:
      console.error('Usage:');
      console.error('  node sign_updater.js generate-signing-key --private-key <path> --public-key <path> [--force]');
      console.error('  node sign_updater.js sign-manifest --input <path> --output <path> --private-key <path>');
      console.error('  node sign_updater.js verify-manifest --input <path> --public-key <path>');
      process.exit(1);
  }
}

main();
