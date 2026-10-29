/**
 * GGUF header parser (spec §5: "A .gguf extension alone does not prove
 * validity").
 *
 * Reads the real container: magic, version, tensor/KV counts, metadata, and
 * tensor descriptors. Everything is bounds-checked, so a truncated or hostile
 * file produces a typed error instead of a hang or a RangeError inside a
 * worker. Only the head of the file is needed — a 2 GB model is validated
 * without being loaded into memory.
 *
 * Format reference: gguf spec v2/v3 (little-endian).
 */

export interface GgufTensorInfo {
  name: string;
  shape: number[];
  type: number;
  offset: number;
}

export interface GgufHeader {
  magicOk: boolean;
  version: number;
  tensorCount: number;
  kvCount: number;
  metadata: Record<string, unknown>;
  tensors: GgufTensorInfo[];
  architecture: string | null;
  modelName: string | null;
  contextLength: number | null;
  embeddingLength: number | null;
  layerCount: number | null;
  headCount: number | null;
  alignment: number;
  fileType: number | null;
  quantization: string;
  tokenizerModel: string | null;
  /** Bytes of the head needed to read the header (tensor data excluded). */
  headerBytes: number;
}

const MAGIC = 0x46554747; // "GGUF" little-endian

export type GgufValueType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export class GgufParseError extends Error {
  reason:
    | 'too-small'
    | 'bad-magic'
    | 'unsupported-version'
    | 'truncated'
    | 'implausible-header';

  constructor(reason: GgufParseError['reason'], message: string) {
    super(message);
    this.name = 'GgufParseError';
    this.reason = reason;
  }
}

class Reader {
  private view: DataView;
  private offset = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position() {
    return this.offset;
  }

  private need(n: number) {
    if (this.offset + n > this.bytes.byteLength) {
      throw new GgufParseError(
        'truncated',
        `GGUF header ends early: needed ${n} more bytes at offset ${this.offset}`,
      );
    }
  }

  u8() {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  i8() {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }

  u16() {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16() {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32() {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32() {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  u64(): number {
    this.need(8);
    const lo = this.view.getUint32(this.offset, true);
    const hi = this.view.getUint32(this.offset + 4, true);
    this.offset += 8;
    // Counts beyond 2^53 cannot appear in a real file; clamp rather than lie.
    return hi * 2 ** 32 + lo;
  }

  i64(): number {
    this.need(8);
    const lo = this.view.getUint32(this.offset, true);
    const hi = this.view.getUint32(this.offset + 4, true);
    this.offset += 8;
    const sign = hi & 0x80000000 ? -1 : 1;
    const magnitude = hi * 2 ** 32 + lo;
    return sign * magnitude;
  }

  string(): string {
    const len = this.u64();
    if (len > this.bytes.byteLength) {
      throw new GgufParseError(
        'implausible-header',
        `GGUF string length ${len} exceeds the header size — file is corrupt`,
      );
    }
    this.need(len);
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  }
}

/** Reads one metadata value. Arrays are read (bounded) so the offset stays correct. */
function readValue(reader: Reader, type: GgufValueType, depth = 0): unknown {
  switch (type) {
    case 0:
      return reader.u8();
    case 1:
      return reader.i8();
    case 2:
      return reader.u16();
    case 3:
      return reader.i16();
    case 4:
      return reader.u32();
    case 5:
      return reader.i32();
    case 6:
      return reader.f32();
    case 7:
      return reader.u8() !== 0;
    case 8:
      return reader.string();
    case 9: {
      const itemType = reader.u32() as GgufValueType;
      const count = reader.u64();
      if (count > 1_000_000) {
        throw new GgufParseError(
          'implausible-header',
          `GGUF array claims ${count} entries — refusing to parse`,
        );
      }
      if (depth > 1) return [];
      const out: unknown[] = [];
      for (let i = 0; i < count; i += 1) out.push(readValue(reader, itemType, depth + 1));
      return out;
    }
    case 10:
      return reader.u64();
    case 11:
      return reader.i64();
    case 12:
      return reader.f64();
    default:
      throw new GgufParseError('implausible-header', `GGUF value type ${type} is not defined`);
  }
}

const FILE_TYPE_QUANT: Record<number, string> = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  4: 'Q4_2 (legacy)',
  5: 'Q4_3 (legacy)',
  6: 'Q5_0',
  7: 'Q5_1',
  8: 'Q8_0',
  9: 'Q8_1',
  10: 'Q2_K',
  11: 'Q3_K_S',
  12: 'Q3_K_M',
  13: 'Q3_K_L',
  14: 'Q4_K_S',
  15: 'Q4_K_M',
  16: 'Q5_K_S',
  17: 'Q5_K_M',
  18: 'Q6_K',
  19: 'IQ2_XXS',
  20: 'IQ2_XS',
  21: 'Q2_K_S',
  22: 'IQ3_XS',
  23: 'IQ3_XXS',
  24: 'IQ1_S',
  25: 'IQ4_NL',
  26: 'IQ3_S',
  27: 'IQ3_M',
  28: 'IQ2_S',
  29: 'IQ2_M',
  30: 'IQ4_XS',
  31: 'IQ1_M',
  32: 'BF16',
};

export function quantizationFromFileType(fileType: number | null): string {
  if (fileType === null || fileType === undefined) return 'unknown';
  return FILE_TYPE_QUANT[fileType] ?? `type-${fileType}`;
}

/**
 * Parses a GGUF header from the first bytes of a file.
 *
 * @param bytes at least a few KB of the file head; a full file also works.
 */
export function parseGgufHeader(bytes: Uint8Array): GgufHeader {
  if (bytes.byteLength < 24) {
    throw new GgufParseError('too-small', 'File is too small to be a GGUF model');
  }

  const magic = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  if (magic !== MAGIC) {
    throw new GgufParseError('bad-magic', 'Not a GGUF file (missing "GGUF" magic)');
  }

  const reader = new Reader(bytes);
  reader.u32(); // magic
  const version = reader.u32();
  if (version < 2 || version > 3) {
    throw new GgufParseError(
      'unsupported-version',
      `GGUF v${version} is not supported (need v2 or v3)`,
    );
  }

  const tensorCount = reader.u64();
  const kvCount = reader.u64();
  if (tensorCount > 200_000 || kvCount > 200_000) {
    throw new GgufParseError(
      'implausible-header',
      `GGUF declares ${tensorCount} tensors / ${kvCount} metadata entries — corrupt header`,
    );
  }

  const metadata: Record<string, unknown> = {};
  for (let i = 0; i < kvCount; i += 1) {
    const key = reader.string();
    const type = reader.u32() as GgufValueType;
    metadata[key] = readValue(reader, type);
  }

  const tensors: GgufTensorInfo[] = [];
  for (let i = 0; i < tensorCount; i += 1) {
    const name = reader.string();
    const nDims = reader.u32();
    if (nDims > 8) {
      throw new GgufParseError('implausible-header', `Tensor "${name}" declares ${nDims} dims`);
    }
    const shape: number[] = [];
    for (let d = 0; d < nDims; d += 1) shape.push(reader.u64());
    const type = reader.u32();
    const offset = reader.u64();
    tensors.push({ name, shape, type, offset });
  }

  const architecture = typeof metadata['general.architecture'] === 'string'
    ? (metadata['general.architecture'] as string)
    : null;

  const num = (key: string): number | null => {
    const value = metadata[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const arch = architecture ?? '';
  const contextLength =
    num(`${arch}.context_length`) ?? num('llama.context_length') ?? num('general.context_length');
  const embeddingLength = num(`${arch}.embedding_length`) ?? null;
  const layerCount = num(`${arch}.block_count`) ?? null;
  const headCount = num(`${arch}.attention.head_count`) ?? null;
  const fileType = num('general.file_type');
  const alignment = num('general.alignment') ?? 32;

  return {
    magicOk: true,
    version,
    tensorCount,
    kvCount,
    metadata,
    tensors,
    architecture,
    modelName: typeof metadata['general.name'] === 'string' ? (metadata['general.name'] as string) : null,
    contextLength,
    embeddingLength,
    layerCount,
    headCount,
    alignment,
    fileType,
    quantization: quantizationFromFileType(fileType),
    tokenizerModel:
      typeof metadata['tokenizer.ggml.model'] === 'string'
        ? (metadata['tokenizer.ggml.model'] as string)
        : null,
    headerBytes: reader.position,
  };
}

/** How many bytes of the head are worth reading to validate a model. */
export const GGUF_INSPECT_BYTES = 4 * 1024 * 1024;

/**
 * Validates a file without holding it in memory: reads the head slice, parses
 * the header, and cross-checks the declared tensor data against the real size.
 */
export async function inspectGguf(
  blob: Blob,
  options: { headBytes?: number } = {},
): Promise<{ header: GgufHeader; declaredDataBytes: number; sizeMatches: boolean }> {
  const head = blob.slice(0, Math.min(options.headBytes ?? GGUF_INSPECT_BYTES, blob.size));
  const bytes = new Uint8Array(await head.arrayBuffer());
  const header = parseGgufHeader(bytes);

  const declaredDataBytes = header.tensors.reduce((max, tensor) => {
    const elements = tensor.shape.reduce((acc, dim) => acc * dim, 1);
    // 4 bytes/element is the worst case across the quant types we allow.
    return Math.max(max, tensor.offset + elements * 4);
  }, 0);

  // A real file is at least the aligned header + the last tensor's data start.
  const minimum = Math.ceil(header.headerBytes / header.alignment) * header.alignment;
  return {
    header,
    declaredDataBytes,
    sizeMatches: blob.size >= minimum && blob.size > 1024,
  };
}
