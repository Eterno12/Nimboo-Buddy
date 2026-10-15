import qrcode from 'qrcode-generator';

/** Módulos do QR (`true` = escuro). Correção de erro M: aguenta reflexo e tela suja sem ficar enorme. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
