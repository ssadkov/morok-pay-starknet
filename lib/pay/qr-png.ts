/**
 * Renders the shareable donation card - label, QR with the mark in the middle,
 * and the MorokPay footer - to a PNG the creator can post anywhere.
 *
 * Drawn on a canvas rather than exported from the on-screen SVG so the file
 * has print-worthy resolution and the surrounding text, instead of being a
 * bare 208px code.
 */

const WIDTH = 1080;
const PADDING = 88;
const QR_SIZE = WIDTH - PADDING * 2;
const LOGO_SHARE = 0.19;

const INK = "#071412";
const MUTED = "#4B6360";
const TEAL = "#0F766E";

export type QrCardOptions = {
  matrix: boolean[][];
  /** Module count including the quiet border. */
  modules: number;
  label: string;
  url: string;
  logoSvg: string;
  network: string;
};

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // A data URI keeps the canvas untainted, so toBlob still works.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not rasterise the logo"));
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/** Shrink the label until it fits, so a long name cannot run off the card. */
function fitLabel(ctx: CanvasRenderingContext2D, label: string) {
  for (let size = 64; size >= 34; size -= 2) {
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    if (ctx.measureText(label).width <= WIDTH - PADDING * 2) return;
  }
}

export async function renderQrCardPng(
  options: QrCardOptions,
): Promise<Blob> {
  const headerHeight = 200;
  const footerHeight = 232;
  const height = headerHeight + QR_SIZE + footerHeight;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot render the PNG");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.textAlign = "center";
  ctx.fillStyle = TEAL;
  ctx.font = "600 30px Inter, system-ui, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillText("PRIVATE DONATION", WIDTH / 2, 92);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = INK;
  fitLabel(ctx, options.label);
  ctx.fillText(options.label, WIDTH / 2, 158);

  // The quiet border is part of the matrix, so the modules fill the box.
  const cell = QR_SIZE / options.modules;
  ctx.fillStyle = INK;
  for (let y = 0; y < options.matrix.length; y += 1) {
    for (let x = 0; x < options.matrix[y].length; x += 1) {
      if (!options.matrix[y][x]) continue;
      ctx.fillRect(
        PADDING + x * cell,
        headerHeight + y * cell,
        // Overdraw a hair so neighbouring modules do not show seams.
        cell + 0.5,
        cell + 0.5,
      );
    }
  }

  const logo = QR_SIZE * LOGO_SHARE;
  const plate = logo * 1.24;
  ctx.fillStyle = "#ffffff";
  roundedRect(
    ctx,
    PADDING + (QR_SIZE - plate) / 2,
    headerHeight + (QR_SIZE - plate) / 2,
    plate,
    plate,
    plate * 0.22,
  );
  ctx.fill();
  ctx.drawImage(
    await loadSvg(options.logoSvg),
    PADDING + (QR_SIZE - logo) / 2,
    headerHeight + (QR_SIZE - logo) / 2,
    logo,
    logo,
  );

  const footerTop = headerHeight + QR_SIZE;
  ctx.fillStyle = INK;
  ctx.font = "600 46px Inter, system-ui, sans-serif";
  ctx.fillText("MorokPay", WIDTH / 2, footerTop + 78);

  ctx.fillStyle = MUTED;
  ctx.font = "400 30px Inter, system-ui, sans-serif";
  ctx.fillText(
    `Private donations on Starknet ${options.network}`,
    WIDTH / 2,
    footerTop + 126,
  );

  ctx.font = "400 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(options.url, WIDTH / 2, footerTop + 180);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode the PNG"));
    }, "image/png");
  });
}

/** Turn a label into a safe, recognisable file name. */
export function qrFileName(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `morokpay-${slug || "donation"}.png`;
}
