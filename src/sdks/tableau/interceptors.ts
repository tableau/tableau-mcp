export type RequestInterceptorConfig = {
  method: string;
  baseUrl: string;
  url: string;
  headers: Record<string, string>;
  data: any;
};

export type ResponseInterceptorConfig = {
  baseUrl: string;
  url: string;
  status: number;
  headers: Record<string, any>;
  data: any;
};

export type RequestInterceptor = (config: RequestInterceptorConfig) => void;
export type ResponseInterceptor = (response: ResponseInterceptorConfig) => void;
