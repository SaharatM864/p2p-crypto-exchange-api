export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
  };
}

export interface ApiResponse<T> {
  data: T;
  meta?: any;
}

export interface PageDto<T> {
  data: T[];
  meta: any;
}
