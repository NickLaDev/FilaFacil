/**
 * Armazenamento de arquivos enviados. A implementação local serve para desenvolvimento;
 * para S3/R2/MinIO basta outra classe com este contrato registrada no StorageModule.
 */
export abstract class FileStorage {
  abstract save(content: Buffer, extension: string, contentType: string): Promise<{ key: string; url: string }>;
  abstract delete(key: string): Promise<void>;
}
