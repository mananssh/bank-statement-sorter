declare module "officecrypto-tool" {
  export function decrypt(buffer: Buffer, options: { password: string }): Promise<Buffer>;
  export function encrypt(buffer: Buffer, options: { password: string }): Promise<Buffer>;
  export function isEncrypted(buffer: Buffer): boolean;
}
