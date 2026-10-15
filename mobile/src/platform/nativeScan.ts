import { Capacitor } from '@capacitor/core';
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

export type ScanOutcome = { ok: true; text: string } | { ok: false; message: string };

/** O leitor nativo do Google (Play Services) existe só no Android; no navegador usa-se a câmera da web. */
export const hasNativeScanner = (): boolean => Capacitor.isNativePlatform();

/**
 * Lê um QR com o leitor do Google. Roda fora do WebView (sem pedir a permissão de câmera do app), então
 * não depende do `getUserMedia`, que trava em alguns Android.
 */
export async function scanQrNative(): Promise<ScanOutcome> {
  try {
    const available = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available.available) {
      // Primeira vez: o Google baixa o módulo de leitura (poucos MB) em segundo plano.
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      return { ok: false, message: 'Baixando o leitor de QR do Google. Tente de novo em alguns segundos.' };
    }
    const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    const text = result.barcodes[0]?.rawValue ?? '';
    return text ? { ok: true, text } : { ok: false, message: 'Não li nenhum QR. Tente de novo.' };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Fechar o leitor sem ler nada vem como erro "canceled": não é falha.
    if (/cancel/i.test(raw)) return { ok: false, message: '' };
    return { ok: false, message: `Não foi possível abrir o leitor de QR (${raw}).` };
  }
}
