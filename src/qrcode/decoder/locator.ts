/**
 * @module locator
 * @author nuintun
 * @author Cosmo Wolfe
 * @license https://raw.githubusercontent.com/cozmo/jsQR/master/LICENSE
 */

import { Point } from './Point';
import { BitMatrix } from './BitMatrix';

const MIN_QUAD_RATIO: number = 0.5;
const MAX_QUAD_RATIO: number = 1.5;
const MAX_FINDERPATTERNS_TO_SEARCH: number = 4;

interface Dimension {
  dimension: number;
  moduleSize: number;
}

interface QuadPoint {
  startX: number;
  endX: number;
  y: number;
}

interface Quad {
  top: QuadPoint;
  bottom: QuadPoint;
}

interface FinderPattern extends Point {
  size: number;
  score: number;
}

interface FinderPatternGroup {
  score: number;
  points: FinderPattern[];
}

interface AlignmentPoint extends Point {
  score: number;
}

interface AlignmentPattern {
  dimension: number;
  alignmentPattern: Point;
}

export interface QRLocation {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  dimension: number;
  alignmentPattern: Point;
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b);
}

interface Patterns {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
}

// Takes three finder patterns and organizes them into topLeft, topRight, etc
function reorderFinderPatterns(pattern1: Point, pattern2: Point, pattern3: Point): Patterns {
  // Find distances between pattern centers
  const oneTwoDistance: number = distance(pattern1, pattern2);
  const twoThreeDistance: number = distance(pattern2, pattern3);
  const oneThreeDistance: number = distance(pattern1, pattern3);

  let topLeft: Point;
  let topRight: Point;
  let bottomLeft: Point;

  // Assume one closest to other two is B; A and C will just be guesses at first
  if (twoThreeDistance >= oneTwoDistance && twoThreeDistance >= oneThreeDistance) {
    [bottomLeft, topLeft, topRight] = [pattern2, pattern1, pattern3];
  } else if (oneThreeDistance >= twoThreeDistance && oneThreeDistance >= oneTwoDistance) {
    [bottomLeft, topLeft, topRight] = [pattern1, pattern2, pattern3];
  } else {
    [bottomLeft, topLeft, topRight] = [pattern1, pattern3, pattern2];
  }

  // Use cross product to figure out whether bottomLeft (A) and topRight (C) are correct or flipped in relation to topLeft (B)
  // This asks whether BC x BA has a positive z component, which is the arrangement we want. If it's negative, then
  // we've got it flipped around and should swap topRight and bottomLeft.
  if ((topRight.x - topLeft.x) * (bottomLeft.y - topLeft.y) - (topRight.y - topLeft.y) * (bottomLeft.x - topLeft.x) < 0) {
    [bottomLeft, topRight] = [topRight, bottomLeft];
  }

  return { bottomLeft, topLeft, topRight };
}

// Computes the dimension (number of modules on a side) of the QR Code based on the position of the finder patterns
function computeDimension(topLeft: Point, topRight: Point, bottomLeft: Point, matrix: BitMatrix): Dimension {
  // Divide by 7 since the ratio is 1:1:3:1:1
  const moduleSize: number =
    (sum(countBlackWhiteRun(topLeft, bottomLeft, matrix, 5)) / 7 +
      sum(countBlackWhiteRun(topLeft, topRight, matrix, 5)) / 7 +
      sum(countBlackWhiteRun(bottomLeft, topLeft, matrix, 5)) / 7 +
      sum(countBlackWhiteRun(topRight, topLeft, matrix, 5)) / 7) /
    4;

  if (moduleSize < 1) {
    throw new Error('invalid module size');
  }

  const topDimension: number = Math.round(distance(topLeft, topRight) / moduleSize);
  const sideDimension: number = Math.round(distance(topLeft, bottomLeft) / moduleSize);

  let dimension: number = Math.floor((topDimension + sideDimension) / 2) + 7;

  switch (dimension % 4) {
    case 0:
      dimension++;
      break;
    case 2:
      dimension--;
      break;
  }

  return { dimension, moduleSize };
}

// Takes an origin point and an end point and counts the sizes of the black white run from the origin towards the end point.
// Returns an array of elements, representing the pixel size of the black white run.
// Uses a variant of http://en.wikipedia.org/wiki/Bresenham's_line_algorithm
function countBlackWhiteRunTowardsPoint(origin: Point, end: Point, matrix: BitMatrix, length: number): number[] {
  const switchPoints: Point[] = [{ x: Math.floor(origin.x), y: Math.floor(origin.y) }];
  const steep: boolean = Math.abs(end.y - origin.y) > Math.abs(end.x - origin.x);

  let fromX: number;
  let fromY: number;
  let toX: number;
  let toY: number;

  if (steep) {
    fromX = Math.floor(origin.y);
    fromY = Math.floor(origin.x);
    toX = Math.floor(end.y);
    toY = Math.floor(end.x);
  } else {
    fromX = Math.floor(origin.x);
    fromY = Math.floor(origin.y);
    toX = Math.floor(end.x);
    toY = Math.floor(end.y);
  }

  const dx: number = Math.abs(toX - fromX);
  const dy: number = Math.abs(toY - fromY);
  const xStep: number = fromX < toX ? 1 : -1;
  const yStep: number = fromY < toY ? 1 : -1;

  let currentPixel: boolean = true;
  let error: number = Math.floor(-dx / 2);

  // Loop up until x == toX, but not beyond
  for (let x: number = fromX, y: number = fromY; x !== toX + xStep; x += xStep) {
    // Does current pixel mean we have moved white to black or vice versa?
    // Scanning black in state 0,2 and white in state 1, so if we find the wrong
    // color, advance to next state or end if we are in state 2 already
    const realX: number = steep ? y : x;
    const realY: number = steep ? x : y;

    if (matrix.get(realX, realY) !== currentPixel) {
      currentPixel = !currentPixel;

      switchPoints.push({ x: realX, y: realY });

      if (switchPoints.length === length + 1) {
        break;
      }
    }

    error += dy;

    if (error > 0) {
      if (y === toY) {
        break;
      }

      y += yStep;
      error -= dx;
    }
  }

  const distances: number[] = [];

  for (let i: number = 0; i < length; i++) {
    if (switchPoints[i] && switchPoints[i + 1]) {
      distances.push(distance(switchPoints[i], switchPoints[i + 1]));
    } else {
      distances.push(0);
    }
  }

  return distances;
}

// Takes an origin point and an end point and counts the sizes of the black white run in the origin point
// along the line that intersects with the end point. Returns an array of elements, representing the pixel sizes
// of the black white run. Takes a length which represents the number of switches from black to white to look for.
function countBlackWhiteRun(origin: Point, end: Point, matrix: BitMatrix, length: number): number[] {
  const rise: number = end.y - origin.y;
  const run: number = end.x - origin.x;

  const towardsEnd: number[] = countBlackWhiteRunTowardsPoint(origin, end, matrix, Math.ceil(length / 2));
  const awayFromEnd: number[] = countBlackWhiteRunTowardsPoint(
    origin,
    { x: origin.x - run, y: origin.y - rise },
    matrix,
    Math.ceil(length / 2)
  );

  const middleValue: number = (towardsEnd.shift() as number) + (awayFromEnd.shift() as number) - 1; // Substract one so we don't double count a pixel

  return awayFromEnd.concat(middleValue).concat(...towardsEnd);
}

type blackWhiteResult = { averageSize: number; error: number };

// Takes in a black white run and an array of expected ratios. Returns the average size of the run as well as the "error" -
// that is the amount the run diverges from the expected ratio
function scoreBlackWhiteRun(sequence: number[], ratios: number[]): blackWhiteResult {
  const averageSize: number = sum(sequence) / sum(ratios);
  let error: number = 0;

  ratios.forEach((ratio, i) => {
    error += (sequence[i] - ratio * averageSize) ** 2;
  });

  return { averageSize, error };
}

// Takes an X,Y point and an array of sizes and scores the point against those ratios.
// For example for a finder pattern takes the ratio list of 1:1:3:1:1 and checks horizontal, vertical and diagonal ratios
// against that.
function scorePattern(point: Point, ratios: number[], matrix: BitMatrix): number {
  try {
    const horizontalRun: number[] = countBlackWhiteRun(point, { x: -1, y: point.y }, matrix, ratios.length);
    const verticalRun: number[] = countBlackWhiteRun(point, { x: point.x, y: -1 }, matrix, ratios.length);

    const topLeftPoint: Point = {
      x: Math.max(0, point.x - point.y) - 1,
      y: Math.max(0, point.y - point.x) - 1
    };
    const topLeftBottomRightRun: number[] = countBlackWhiteRun(point, topLeftPoint, matrix, ratios.length);

    const bottomLeftPoint: Point = {
      x: Math.min(matrix.width, point.x + point.y) + 1,
      y: Math.min(matrix.height, point.y + point.x) + 1
    };
    const bottomLeftTopRightRun: number[] = countBlackWhiteRun(point, bottomLeftPoint, matrix, ratios.length);

    const horzError: blackWhiteResult = scoreBlackWhiteRun(horizontalRun, ratios);
    const vertError: blackWhiteResult = scoreBlackWhiteRun(verticalRun, ratios);
    const diagDownError: blackWhiteResult = scoreBlackWhiteRun(topLeftBottomRightRun, ratios);
    const diagUpError: blackWhiteResult = scoreBlackWhiteRun(bottomLeftTopRightRun, ratios);

    const ratioError: number = Math.sqrt(
      horzError.error * horzError.error +
        vertError.error * vertError.error +
        diagDownError.error * diagDownError.error +
        diagUpError.error * diagUpError.error
    );

    const avgSize: number =
      (horzError.averageSize + vertError.averageSize + diagDownError.averageSize + diagUpError.averageSize) / 4;

    const sizeError: number =
      ((horzError.averageSize - avgSize) ** 2 +
        (vertError.averageSize - avgSize) ** 2 +
        (diagDownError.averageSize - avgSize) ** 2 +
        (diagUpError.averageSize - avgSize) ** 2) /
      avgSize;

    return ratioError + sizeError;
  } catch {
    return Infinity;
  }
}

function recenterLocation(matrix: BitMatrix, point: Point): Point {
  let leftX: number = Math.round(point.x);

  while (matrix.get(leftX, Math.round(point.y))) {
    leftX--;
  }

  let rightX: number = Math.round(point.x);

  while (matrix.get(rightX, Math.round(point.y))) {
    rightX++;
  }

  const x: number = (leftX + rightX) / 2;

  let topY: number = Math.round(point.y);

  while (matrix.get(Math.round(x), topY)) {
    topY--;
  }

  let bottomY: number = Math.round(point.y);

  while (matrix.get(Math.round(x), bottomY)) {
    bottomY++;
  }

  const y: number = (topY + bottomY) / 2;

  return { x, y };
}

function findAlignmentPattern(
  matrix: BitMatrix,
  alignmentPatternQuads: Quad[],
  topRight: Point,
  topLeft: Point,
  bottomLeft: Point
): AlignmentPattern | null {
  // Now that we've found the three finder patterns we can determine the blockSize and the size of the QR code.
  // We'll use these to help find the alignment pattern but also later when we do the extraction.
  let dimension: number;
  let moduleSize: number;

  try {
    ({ dimension, moduleSize } = computeDimension(topLeft, topRight, bottomLeft, matrix));
  } catch {
    return null;
  }

  // Now find the alignment pattern
  const bottomRightFinderPattern: Point = {
    // Best guess at where a bottomRight finder pattern would be
    x: topRight.x - topLeft.x + bottomLeft.x,
    y: topRight.y - topLeft.y + bottomLeft.y
  };
  const modulesBetweenFinderPatterns: number = (distance(topLeft, bottomLeft) + distance(topLeft, topRight)) / 2 / moduleSize;
  const correctionToTopLeft: number = 1 - 3 / modulesBetweenFinderPatterns;
  const expectedAlignmentPattern: Point = {
    x: topLeft.x + correctionToTopLeft * (bottomRightFinderPattern.x - topLeft.x),
    y: topLeft.y + correctionToTopLeft * (bottomRightFinderPattern.y - topLeft.y)
  };

  // const alignmentPatterns: AlignmentPoint[] = alignmentPatternQuads
  //   .filter(({ top, bottom }) => {
  //     const x: number = (top.startX + top.endX + bottom.startX + bottom.endX) / 4;
  //     const y: number = (top.y + bottom.y + 1) / 2;

  //     return matrix.get(Math.floor(x), Math.floor(y));
  //   })
  //   .map(({ top, bottom }) => {
  //     const x: number = (top.startX + top.endX + bottom.startX + bottom.endX) / 4;
  //     const y: number = (top.y + bottom.y + 1) / 2;
  //     const sizeScore: number = scorePattern({ x: Math.floor(x), y: Math.floor(y) }, [1, 1, 1], matrix);
  //     const score: number = sizeScore + distance({ x, y }, expectedAlignmentPattern);

  //     return { x, y, score };
  //   })
  //   .sort((a, b) => a.score - b.score);

  const alignmentPatterns: AlignmentPoint[] = alignmentPatternQuads
    .reduce<AlignmentPoint[]>((quads, { top, bottom }) => {
      const x: number = (top.startX + top.endX + bottom.startX + bottom.endX) / 4;
      const y: number = (top.y + bottom.y + 1) / 2;
      const intX = Math.floor(x);
      const intY = Math.floor(y);

      if (matrix.get(intX, intY)) {
        const sizeScore: number = scorePattern({ x: intX, y: intY }, [1, 1, 1], matrix);
        const score: number = sizeScore + distance({ x, y }, expectedAlignmentPattern);

        quads.push({ x, y, score });
      }

      return quads;
    }, [])
    .sort((a, b) => a.score - b.score);

  // If there are less than 15 modules between finder patterns it's a version 1 QR code and as such has no alignmemnt pattern
  // so we can only use our best guess.
  const alignmentPattern: Point =
    modulesBetweenFinderPatterns >= 15 && alignmentPatterns.length ? alignmentPatterns[0] : expectedAlignmentPattern;

  return { alignmentPattern, dimension };
}

export function locate(matrix: BitMatrix): QRLocation[] | null {
  const finderPatternQuads: Quad[] = [];
  const alignmentPatternQuads: Quad[] = [];

  let activeFinderPatternQuads: Quad[] = [];
  let activeAlignmentPatternQuads: Quad[] = [];

  for (let y: number = 0; y <= matrix.height; y++) {
    let length: number = 0;
    let lastBit: boolean = false;
    let scans: number[] = [0, 0, 0, 0, 0];

    for (let x: number = -1; x <= matrix.width; x++) {
      const v: boolean = matrix.get(x, y);

      if (v === lastBit) {
        length++;
      } else {
        scans = [scans[1], scans[2], scans[3], scans[4], length];
        length = 1;
        lastBit = v;

        // Do the last 5 color changes ~ match the expected ratio for a finder pattern? 1:1:3:1:1 of b:w:b:w:b
        const averageFinderPatternBlocksize: number = sum(scans) / 7;
        const validFinderPattern: boolean =
          Math.abs(scans[0] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
          Math.abs(scans[1] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
          Math.abs(scans[2] - 3 * averageFinderPatternBlocksize) < 3 * averageFinderPatternBlocksize &&
          Math.abs(scans[3] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
          Math.abs(scans[4] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
          !v; // And make sure the current pixel is white since finder patterns are bordered in white

        // Do the last 3 color changes ~ match the expected ratio for an alignment pattern? 1:1:1 of w:b:w
        const averageAlignmentPatternBlocksize: number = sum(scans.slice(-3)) / 3;
        const validAlignmentPattern: boolean =
          Math.abs(scans[2] - averageAlignmentPatternBlocksize) < averageAlignmentPatternBlocksize &&
          Math.abs(scans[3] - averageAlignmentPatternBlocksize) < averageAlignmentPatternBlocksize &&
          Math.abs(scans[4] - averageAlignmentPatternBlocksize) < averageAlignmentPatternBlocksize &&
          v; // Is the current pixel black since alignment patterns are bordered in black

        if (validFinderPattern) {
          // Compute the start and end x values of the large center black square
          const endX: number = x - scans[3] - scans[4];
          const startX: number = endX - scans[2];

          const line: QuadPoint = { startX, endX, y };
          // Is there a quad directly above the current spot? If so, extend it with the new line. Otherwise, create a new quad with
          // that line as the starting point.
          const matchingQuads: Quad[] = activeFinderPatternQuads.filter(
            q =>
              (startX >= q.bottom.startX && startX <= q.bottom.endX) ||
              (endX >= q.bottom.startX && startX <= q.bottom.endX) ||
              (startX <= q.bottom.startX &&
                endX >= q.bottom.endX &&
                scans[2] / (q.bottom.endX - q.bottom.startX) < MAX_QUAD_RATIO &&
                scans[2] / (q.bottom.endX - q.bottom.startX) > MIN_QUAD_RATIO)
          );

          if (matchingQuads.length > 0) {
            matchingQuads[0].bottom = line;
          } else {
            activeFinderPatternQuads.push({ top: line, bottom: line });
          }
        }

        if (validAlignmentPattern) {
          // Compute the start and end x values of the center black square
          const endX: number = x - scans[4];
          const startX: number = endX - scans[3];

          const line: QuadPoint = { startX, y, endX };
          // Is there a quad directly above the current spot? If so, extend it with the new line. Otherwise, create a new quad with
          // that line as the starting point.
          const matchingQuads: Quad[] = activeAlignmentPatternQuads.filter(
            q =>
              (startX >= q.bottom.startX && startX <= q.bottom.endX) ||
              (endX >= q.bottom.startX && startX <= q.bottom.endX) ||
              (startX <= q.bottom.startX &&
                endX >= q.bottom.endX &&
                scans[2] / (q.bottom.endX - q.bottom.startX) < MAX_QUAD_RATIO &&
                scans[2] / (q.bottom.endX - q.bottom.startX) > MIN_QUAD_RATIO)
          );

          if (matchingQuads.length > 0) {
            matchingQuads[0].bottom = line;
          } else {
            activeAlignmentPatternQuads.push({ top: line, bottom: line });
          }
        }
      }
    }

    finderPatternQuads.push(...activeFinderPatternQuads.filter(q => q.bottom.y !== y && q.bottom.y - q.top.y >= 2));

    activeFinderPatternQuads = activeFinderPatternQuads.filter(q => q.bottom.y === y);

    alignmentPatternQuads.push(...activeAlignmentPatternQuads.filter(q => q.bottom.y !== y));

    activeAlignmentPatternQuads = activeAlignmentPatternQuads.filter(q => q.bottom.y === y);
  }

  finderPatternQuads.push(...activeFinderPatternQuads.filter(q => q.bottom.y - q.top.y >= 2));
  alignmentPatternQuads.push(...activeAlignmentPatternQuads);

  // const finderPatternGroups: FinderPatternGroup[] = finderPatternQuads
  //   .filter(q => q.bottom.y - q.top.y >= 2) // All quads must be at least 2px tall since the center square is larger than a block
  //   .map(q => {
  //     // Initial scoring of finder pattern quads by looking at their ratios, not taking into account position
  //     const x: number = (q.top.startX + q.top.endX + q.bottom.startX + q.bottom.endX) / 4;
  //     const y: number = (q.top.y + q.bottom.y + 1) / 2;

  //     if (!matrix.get(Math.round(x), Math.round(y))) {
  //       return;
  //     }

  //     const lengths: number[] = [q.top.endX - q.top.startX, q.bottom.endX - q.bottom.startX, q.bottom.y - q.top.y + 1];
  //     const size: number = sum(lengths) / lengths.length;
  //     const score: number = scorePattern({ x: Math.round(x), y: Math.round(y) }, [1, 1, 3, 1, 1], matrix);

  //     return { score, x, y, size };
  //   })
  //   .filter(q => !!q) // Filter out any rejected quads from above
  //   .sort((a, b) => a.score - b.score)
  //   // Now take the top finder pattern options and try to find 2 other options with a similar size.
  //   .map((point, i, finderPatterns) => {
  //     if (i > MAX_FINDERPATTERNS_TO_SEARCH) {
  //       return null;
  //     }

  //     const otherPoints: FinderPattern[] = finderPatterns
  //       .filter((_p, ii) => i !== ii)
  //       .map(p => ({ x: p.x, y: p.y, score: p.score + (p.size - point.size) ** 2 / point.size, size: p.size }))
  //       .sort((a, b) => a.score - b.score);

  //     if (otherPoints.length < 2) {
  //       return null;
  //     }

  //     const score: number = point.score + otherPoints[0].score + otherPoints[1].score;

  //     return { points: [point].concat(otherPoints.slice(0, 2)), score };
  //   })
  //   .filter(q => !!q) // Filter out any rejected finder patterns from above
  //   .sort((a, b) => a.score - b.score);

  const finderPatterns: FinderPattern[] = finderPatternQuads
    .reduce<FinderPattern[]>((quads, { top, bottom }) => {
      // All quads must be at least 2px tall since the center square is larger than a block
      if (bottom.y - top.y >= 2) {
        // Initial scoring of finder pattern quads by looking at their ratios, not taking into account position
        const x: number = (top.startX + top.endX + bottom.startX + bottom.endX) / 4;
        const y: number = (top.y + bottom.y + 1) / 2;
        const intX = Math.round(x);
        const intY = Math.round(y);

        if (matrix.get(intX, intY)) {
          const lengths: number[] = [top.endX - top.startX, bottom.endX - bottom.startX, bottom.y - top.y + 1];
          const size: number = sum(lengths) / lengths.length;
          const score: number = scorePattern({ x: intX, y: intY }, [1, 1, 3, 1, 1], matrix);

          quads.push({ x, y, size, score });
        }
      }

      return quads;
    }, [])
    .sort((a, b) => a.score - b.score);

  const finderPatternGroups: FinderPatternGroup[] = finderPatterns
    .reduce<FinderPatternGroup[]>((points, point, index, finderPatterns) => {
      if (index <= MAX_FINDERPATTERNS_TO_SEARCH) {
        const otherPoints: FinderPattern[] = finderPatterns.reduce<FinderPattern[]>((points, { x, y, size, score }, oIndex) => {
          if (index !== oIndex) {
            points.push({ x, y, size, score: score + (size - point.size) ** 2 / point.size });
          }

          return points;
        }, []);
        if (otherPoints.length >= 2) {
          const score: number = point.score + otherPoints[0].score + otherPoints[1].score;

          points.push({ points: [point].concat(otherPoints.sort((a, b) => a.score - b.score).slice(0, 2)), score });
        }
      }

      return points;
    }, [])
    .sort((a, b) => a.score - b.score);

  if (finderPatternGroups.length === 0) {
    return null;
  }

  const { topRight, topLeft, bottomLeft }: Patterns = reorderFinderPatterns(
    finderPatternGroups[0].points[0],
    finderPatternGroups[0].points[1],
    finderPatternGroups[0].points[2]
  );

  const result: QRLocation[] = [];
  const alignment: AlignmentPattern | null = findAlignmentPattern(matrix, alignmentPatternQuads, topRight, topLeft, bottomLeft);

  if (alignment !== null) {
    result.push({
      alignmentPattern: { x: alignment.alignmentPattern.x, y: alignment.alignmentPattern.y },
      bottomLeft: { x: bottomLeft.x, y: bottomLeft.y },
      dimension: alignment.dimension,
      topLeft: { x: topLeft.x, y: topLeft.y },
      topRight: { x: topRight.x, y: topRight.y }
    });
  }

  // We normally use the center of the quads as the location of the tracking points, which is optimal for most cases and will account
  // for a skew in the image. However, In some cases, a slight skew might not be real and instead be caused by image compression
  // errors and/or low resolution. For those cases, we'd be better off centering the point exactly in the middle of the black area. We
  // compute and return the location data for the naively centered points as it is little additional work and allows for multiple
  // attempts at decoding harder images.
  const midTopRight: Point = recenterLocation(matrix, topRight);
  const midTopLeft: Point = recenterLocation(matrix, topLeft);
  const midBottomLeft: Point = recenterLocation(matrix, bottomLeft);
  const centeredAlignment: AlignmentPattern | null = findAlignmentPattern(
    matrix,
    alignmentPatternQuads,
    midTopRight,
    midTopLeft,
    midBottomLeft
  );

  if (centeredAlignment !== null) {
    result.push({
      alignmentPattern: { x: centeredAlignment.alignmentPattern.x, y: centeredAlignment.alignmentPattern.y },
      bottomLeft: { x: midBottomLeft.x, y: midBottomLeft.y },
      topLeft: { x: midTopLeft.x, y: midTopLeft.y },
      topRight: { x: midTopRight.x, y: midTopRight.y },
      dimension: centeredAlignment.dimension
    });
  }

  if (result.length === 0) {
    return null;
  }

  return result;
}
