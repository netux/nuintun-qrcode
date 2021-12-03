/**
 * @module GIF Image (B/W)
 * @author nuintun
 * @author Kazuhiko Arase
 */

import { OutputStream } from '../io/OutputStream';
import { ByteArrayOutputStream } from '../io/ByteArrayOutputStream';
import { Base64EncodeOutputStream } from '../io/Base64EncodeOutputStream';

function encodeToBase64(data: number[]): number[] {
  const output: ByteArrayOutputStream = new ByteArrayOutputStream();
  const stream: Base64EncodeOutputStream = new Base64EncodeOutputStream(output);

  stream.writeBytes(data);
  stream.close();

  output.close();

  return output.toByteArray();
}

class LZWTable {
  private size: number = 0;
  private map: { [key: string]: number } = {};

  public add(key: string): void {
    if (!this.contains(key)) {
      this.map[key] = this.size++;
    }
  }

  public getSize(): number {
    return this.size;
  }

  public indexOf(key: string): number {
    return this.map[key];
  }

  public contains(key: string): boolean {
    return this.map[key] >= 0;
  }
}

class BitOutputStream {
  private bitLength: number = 0;
  private bitBuffer: number = 0;

  constructor(private output: OutputStream) {}

  public write(data: number, length: number): void {
    if (data >>> length !== 0) {
      throw new Error('length overflow');
    }

    const { output } = this;

    while (this.bitLength + length >= 8) {
      output.writeByte(0xff & ((data << this.bitLength) | this.bitBuffer));

      length -= 8 - this.bitLength;
      data >>>= 8 - this.bitLength;

      this.bitBuffer = 0;
      this.bitLength = 0;
    }

    this.bitBuffer = (data << this.bitLength) | this.bitBuffer;
    this.bitLength = this.bitLength + length;
  }

  public flush(): void {
    const { output } = this;

    if (this.bitLength > 0) {
      output.writeByte(this.bitBuffer);
    }

    output.flush();
  }

  public close(): void {
    this.flush();
    this.output.close();
  }
}

export class GIFImage {
  private width: number;
  private height: number;
  private data: number[];

  constructor(width: number, height: number) {
    this.data = [];
    this.width = width;
    this.height = height;

    const size: number = width * height;

    for (let i: number = 0; i < size; i++) {
      this.data[i] = 0;
    }
  }

  private getLZWRaster(lzwMinCodeSize: number): number[] {
    // Setup LZWTable
    const { fromCharCode } = String;
    const table: LZWTable = new LZWTable();
    const clearCode: number = 1 << lzwMinCodeSize;
    const endCode: number = (1 << lzwMinCodeSize) + 1;

    for (let i: number = 0; i < clearCode; i++) {
      table.add(fromCharCode(i));
    }

    table.add(fromCharCode(clearCode));
    table.add(fromCharCode(endCode));

    let bitLength: number = lzwMinCodeSize + 1;

    const byteOutput: ByteArrayOutputStream = new ByteArrayOutputStream();
    const bitOutput: BitOutputStream = new BitOutputStream(byteOutput);

    try {
      const { data } = this;
      const { length } = data;
      const { fromCharCode } = String;

      // Clear code
      bitOutput.write(clearCode, bitLength);

      let dataIndex: number = 0;
      let words: string = fromCharCode(data[dataIndex++]);

      while (dataIndex < length) {
        const char: string = fromCharCode(data[dataIndex++]);

        if (table.contains(words + char)) {
          words += char;
        } else {
          bitOutput.write(table.indexOf(words), bitLength);

          if (table.getSize() < 0xfff) {
            if (table.getSize() === 1 << bitLength) {
              bitLength++;
            }

            table.add(words + char);
          }

          words = char;
        }
      }

      bitOutput.write(table.indexOf(words), bitLength);
      // End code
      bitOutput.write(endCode, bitLength);
    } finally {
      bitOutput.close();
    }

    return byteOutput.toByteArray();
  }

  private writeWord(output: OutputStream, i: number): void {
    output.writeByte(i & 0xff);
    output.writeByte((i >>> 8) & 0xff);
  }

  private writeBytes(output: OutputStream, bytes: number[], off: number, length: number): void {
    for (let i: number = 0; i < length; i++) {
      output.writeByte(bytes[i + off]);
    }
  }

  public setPixel(x: number, y: number, pixel: number): void {
    const { width, height } = this;

    if (x < 0 || width <= x) throw new Error(`illegal x axis: ${x}`);

    if (y < 0 || height <= y) throw new Error(`illegal y axis: ${y}`);

    this.data[y * width + x] = pixel;
  }

  public getPixel(x: number, y: number): number {
    const { width, height } = this;

    if (x < 0 || width <= x) throw new Error(`illegal x axis: ${x}`);

    if (y < 0 || height <= y) throw new Error(`illegal y axis: ${y}`);

    return this.data[y * width + x];
  }

  public write(output: OutputStream): void {
    const { width, height } = this;

    // GIF Signature
    output.writeByte(0x47); // G
    output.writeByte(0x49); // I
    output.writeByte(0x46); // F
    output.writeByte(0x38); // 8
    output.writeByte(0x37); // 7
    output.writeByte(0x61); // a

    // Screen Descriptor
    this.writeWord(output, width);
    this.writeWord(output, height);

    output.writeByte(0x80); // 2bit
    output.writeByte(0);
    output.writeByte(0);

    // Global Color Map
    // Black
    output.writeByte(0x00);
    output.writeByte(0x00);
    output.writeByte(0x00);

    // White
    output.writeByte(0xff);
    output.writeByte(0xff);
    output.writeByte(0xff);

    // Image Descriptor
    output.writeByte(0x2c); // ,

    this.writeWord(output, 0);
    this.writeWord(output, 0);
    this.writeWord(output, width);
    this.writeWord(output, height);

    output.writeByte(0);

    // Local Color Map
    // Raster Data
    const lzwMinCodeSize: number = 2;
    const raster: number[] = this.getLZWRaster(lzwMinCodeSize);
    const raLength: number = raster.length;

    output.writeByte(lzwMinCodeSize);

    let offset: number = 0;

    while (raLength - offset > 255) {
      output.writeByte(255);

      this.writeBytes(output, raster, offset, 255);

      offset += 255;
    }

    const length: number = raLength - offset;

    output.writeByte(length);

    this.writeBytes(output, raster, offset, length);

    output.writeByte(0x00);

    // GIF Terminator
    output.writeByte(0x3b); // ;
  }

  public toDataURL(): string {
    const output: ByteArrayOutputStream = new ByteArrayOutputStream();

    this.write(output);

    const bytes: number[] = encodeToBase64(output.toByteArray());

    output.close();

    const { length } = bytes;
    const { fromCharCode } = String;

    let url: string = 'data:image/gif;base64,';

    for (let i: number = 0; i < length; i++) {
      url += fromCharCode(bytes[i]);
    }

    return url;
  }
}
