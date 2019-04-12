/**
 * @class QRData
 * @author nuintun
 * @author Kazuhiko Arase
 */

import Mode from './Mode';
import BitBuffer from './BitBuffer';

export default abstract class QRData {
  private mode: Mode;
  private data: string;

  constructor(mode: Mode, data: string) {
    this.mode = mode;
    this.data = data;
  }

  public getMode(): Mode {
    return this.mode;
  }

  public getData(): string {
    return this.data;
  }

  public abstract getLength(): number;

  public abstract write(buffer: BitBuffer): void;

  public getLengthInBits(typeNumber: number): number {
    const mode: Mode = this.mode;
    const error: string = `unknow mode: ${mode}`;

    if (1 <= typeNumber && typeNumber < 10) {
      // 1 - 9
      switch (mode) {
        case Mode.Numeric:
          return 10;
        case Mode.Alphanumeric:
          return 9;
        case Mode.Byte:
          return 8;
        case Mode.Kanji:
          return 8;
        default:
          throw error;
      }
    } else if (typeNumber < 27) {
      // 10 - 26
      switch (mode) {
        case Mode.Numeric:
          return 12;
        case Mode.Alphanumeric:
          return 11;
        case Mode.Byte:
          return 16;
        case Mode.Kanji:
          return 10;
        default:
          throw error;
      }
    } else if (typeNumber < 41) {
      // 27 - 40
      switch (mode) {
        case Mode.Numeric:
          return 14;
        case Mode.Alphanumeric:
          return 13;
        case Mode.Byte:
          return 16;
        case Mode.Kanji:
          return 12;
        default:
          throw error;
      }
    } else {
      throw `unknow type number: ${typeNumber}`;
    }
  }
}