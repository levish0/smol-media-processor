export class MediaProcessingError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MediaProcessingError";
    this.status = status;
    this.code = code;
  }
}
