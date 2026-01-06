export type FillDocsSignedUrlResponse = {
  success: true;
  template: 'ER' | 'FBA' | 'PR';
  filename: string;
  contentType: string;
  downloadUrl: string;
  bucketId?: string;
  objectPath?: string;
};

export type FillDocsBase64Response = {
  success: true;
  template: 'ER' | 'FBA' | 'PR';
  filename: string;
  contentType: string;
  base64: string;
};

export type FillDocsResponse = FillDocsSignedUrlResponse | FillDocsBase64Response;

export type FillDocsDownloadPlan =
  | { kind: 'signed-url'; url: string; filename: string }
  | { kind: 'base64'; base64: string; filename: string; contentType: string };

export function getFillDocsDownloadPlan(response: FillDocsResponse): FillDocsDownloadPlan {
  if ('downloadUrl' in response && typeof response.downloadUrl === 'string' && response.downloadUrl.length > 0) {
    return { kind: 'signed-url', url: response.downloadUrl, filename: response.filename };
  }

  if ('base64' in response && typeof response.base64 === 'string' && response.base64.length > 0) {
    return {
      kind: 'base64',
      base64: response.base64,
      filename: response.filename,
      contentType: response.contentType,
    };
  }

  // Defensive: should never happen if the function conforms to contract.
  throw new Error('Fill docs response missing downloadUrl/base64');
}

