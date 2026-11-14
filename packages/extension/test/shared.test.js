import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { zipFiles, unzipFiles, crc32 } from '../src/shared/zip.js';
import { diffLines } from '../src/shared/diff.js';
import { extractCode } from '../src/ui/ai-extract.js';

test('crc32 matches the reference implementation', () => {
  const data = new TextEncoder().encode('TamperDonkey ✓');
  assert.equal(crc32(data), zlib.crc32(data));
});

test('zip round trip keeps names and UTF-8 text', async () => {
  const files = [{ name: 'a.user.js', text: '// ==UserScript==\n// @name Ünï\n' }, { name: 'tamperdonkey.json', text: '{"scripts":[]}' }];
  assert.deepEqual(await unzipFiles(zipFiles(files)), files);
});

test('reads a deflate-compressed zip made by another tool', async () => {
  // Build a one-file deflated archive by hand.
  const name = Buffer.from('x.user.js');
  const text = Buffer.from('hello hello hello hello');
  const comp = zlib.deflateRawSync(text);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(zlib.crc32(text), 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(text.length, 24); cd.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + comp.length, 16);
  const zip = new Uint8Array(Buffer.concat([local, name, comp, cd, name, end]));
  assert.deepEqual(await unzipFiles(zip), [{ name: 'x.user.js', text: 'hello hello hello hello' }]);
});

test('rejects data that is not a zip', async () => {
  await assert.rejects(unzipFiles(new Uint8Array(100)), /Not a ZIP/);
});

test('diffLines marks added and removed lines', () => {
  const d = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(d.map((l) => `${l.type[0]}${l.text}`), ['sa', 'db', 'aB', 'sc', 'sd', 'ae']);
  assert.ok(diffLines('same\ntext', 'same\ntext').every((l) => l.type === 'same'));
});

test('extractCode takes the block that holds a userscript header', () => {
  const answer = 'Here:\n```js\nconsole.log(1)\n```\nand\n```javascript\n// ==UserScript==\n// @name X\n// ==/UserScript==\n```\nDone.';
  assert.equal(extractCode(answer), '// ==UserScript==\n// @name X\n// ==/UserScript==\n');
  assert.equal(extractCode('no code here'), null);
});
