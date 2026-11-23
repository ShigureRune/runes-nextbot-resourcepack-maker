import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedJarUrl, jarFilename, MOD_DOWNLOAD_JAR_URL } from '../src/modRelease.ts';

test('mod download stays unavailable until a verified real JAR asset URL is configured', () => {
  assert.equal(MOD_DOWNLOAD_JAR_URL, null);
  assert.equal(verifiedJarUrl(MOD_DOWNLOAD_JAR_URL), null);
});

test('accepts only direct HTTPS JAR URLs, not release pages or unsafe schemes', () => {
  const jar = 'https://github.com/owner/mod/releases/download/v1/mod-v1.jar';
  assert.equal(verifiedJarUrl(jar), jar);
  assert.equal(verifiedJarUrl('https://example.com/mod.JAR?download=1'), 'https://example.com/mod.JAR?download=1');
  for (const invalid of [
    null, '', 'https://github.com/owner/mod/releases/latest', 'http://example.com/mod.jar',
    'javascript:alert(1)', 'data:application/java-archive,stuff',
    'https://example.com/installer.exe', 'https://user:pass@example.com/mod.jar',
  ]) {
    assert.equal(verifiedJarUrl(invalid), null);
  }
});

test('provides the JAR name as a browser download hint', () => {
  assert.equal(jarFilename('https://example.com/releases/runes-nextbot-1.0.jar'), 'runes-nextbot-1.0.jar');
  assert.equal(jarFilename('https://example.com/runes%20nextbot.jar?token=abc'), 'runes nextbot.jar');
});
