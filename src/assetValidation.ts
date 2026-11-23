/** Basic file format checks for stage 01 (not a full media decoder). */
export async function isPng(file: Blob): Promise<boolean> {
  if (file.size < 24) return false;
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((byte, index) => header[index] === byte) &&
    header[12] === 73 && header[13] === 72 && header[14] === 68 && header[15] === 82;
}

export async function isOggVorbis(file: Blob): Promise<boolean> {
  if (file.size < 35) return false;
  const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const oggMagic = [79, 103, 103, 83];
  if (!oggMagic.every((byte, index) => header[index] === byte)) return false;
  // Vorbis identification packet begins with 0x01 + "vorbis".
  const vorbis = [1, 118, 111, 114, 98, 105, 115];
  for (let i = 4; i <= header.length - vorbis.length; i++) {
    if (vorbis.every((byte, offset) => header[i + offset] === byte)) return true;
  }
  return false;
}
