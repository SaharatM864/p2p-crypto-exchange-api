import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import * as fs from 'fs';
import * as path from 'path';

import * as ConverterLib from 'openapi-to-postmanv2';

// Define a type for the Converter library since it lacks @types
interface PostmanConverter {
  convert: (
    input: { type: 'string' | 'json'; data: Record<string, unknown> },
    options: PostmanConverterOptions,
    callback: (err: Error | null, conversionResult: ConversionResult) => void,
  ) => void;
}

// Cast to the interface to ensure type safety
const Converter = ConverterLib as unknown as PostmanConverter;

interface PostmanConverterOptions {
  folderStrategy: string;
  requestParametersResolution: string;
  exampleParametersResolution: string;
  indentCharacter: string;
  requestNameSource: string;
  includeAuthInfoInExample: boolean;
  enableOptionalParameters: boolean;
  nestedFolderHierarchy: boolean;
}

interface ConversionResult {
  result: boolean;
  reason: string;
  output: { data: Record<string, unknown> }[];
}

// Define specific types for the OpenApi structure we are traversing
interface OpenApiNode {
  [key: string]: any;
  allOf?: ({ $ref: string } | { properties: { data: unknown } })[];
  type?: string;
  properties?: Record<string, unknown>;
  $ref?: string;
}

async function generatePostmanCollection() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('P2P Crypto Exchange API')
    .setDescription('The P2P Crypto Exchange API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'access-token',
    )
    .addServer('http://localhost:3000', 'Local environment')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const options: PostmanConverterOptions = {
    folderStrategy: 'Tags',
    requestParametersResolution: 'Example',
    exampleParametersResolution: 'Example',
    indentCharacter: 'Space',
    requestNameSource: 'Fallback',
    includeAuthInfoInExample: true,
    enableOptionalParameters: true,
    nestedFolderHierarchy: true,
  };

  const convert = (input: OpenAPIObject, options: PostmanConverterOptions) => {
    return new Promise((resolve, reject) => {
      Converter.convert(
        { type: 'json', data: input as unknown as Record<string, unknown> },
        options,
        (err: Error | null, conversionResult: ConversionResult) => {
          if (err) {
            return reject(err);
          }
          if (!conversionResult.result) {
            return reject(new Error(conversionResult.reason));
          }
          resolve(conversionResult.output[0].data);
        },
      );
    });
  };

  // PATCH: Flatten 'allOf' for BaseResponseDto to avoid openapi-to-postmanv2 errors

  const patchDocument = (doc: OpenAPIObject) => {
    // Helper to traverse and patch schemas

    const traverse = (obj: OpenApiNode) => {
      if (!obj || typeof obj !== 'object') return;

      // Check if it's the specific allOf pattern we used in ApiStandardResponse
      if (
        obj.allOf &&
        Array.isArray(obj.allOf) &&
        obj.allOf.length === 2 &&
        'properties' in obj.allOf[1] && // Check if properties exists
        (obj.allOf[1] as { properties: { data?: unknown } }).properties?.data
      ) {
        // Flatten it!
        obj.type = 'object';
        obj.properties = {
          statusCode: { type: 'number', example: 200 },
          message: { type: 'string', example: 'Success' },
          data: (obj.allOf[1] as { properties: { data: unknown } }).properties
            .data,
        };
        // Remove allOf
        delete obj.allOf;
      } else if (
        obj.allOf &&
        Array.isArray(obj.allOf) &&
        obj.allOf.length === 1 &&
        '$ref' in obj.allOf[0]
      ) {
        // Flatten simple allOf wrapping a ref (common in Enums)
        const firstItem = obj.allOf[0] as { $ref: string };
        obj.$ref = firstItem.$ref;
        delete obj.allOf;
      } else {
        // Recursive traverse
        Object.keys(obj).forEach((key) => traverse(obj[key] as OpenApiNode));
      }
    };

    traverse(doc as unknown as OpenApiNode);
    return doc;
  };

  const patchedDocument = patchDocument(document);

  try {
    const outputPath = path.resolve(__dirname, '../postman');

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath);
    }

    const collection = await convert(patchedDocument, options);

    const collectionData = collection;

    fs.writeFileSync(
      path.join(outputPath, 'P2P-Crypto-Exchange-API.postman_collection.json'),
      JSON.stringify(collectionData, null, 2),
    );

    console.log(
      'Postman collection generated successfully at postman/P2P-Crypto-Exchange-API.postman_collection.json',
    );
  } catch (err) {
    console.error('Error generating Postman collection:', err);
    process.exit(1);
  } finally {
    await app.close();
  }
}

generatePostmanCollection().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
