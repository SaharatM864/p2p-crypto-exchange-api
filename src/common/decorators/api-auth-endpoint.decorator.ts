import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

export function ApiAuthEndpoint(summary: string) {
  return applyDecorators(
    ApiOperation({ summary }),
    ApiBearerAuth('access-token'),
    ApiResponse({ status: 401, description: 'Unauthorized' }),
    ApiResponse({ status: 403, description: 'Forbidden' }),
    ApiResponse({ status: 500, description: 'Internal Server Error' }),
  );
}
