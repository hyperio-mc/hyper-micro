/**
 * @fileoverview Zod validation schemas for API inputs
 * 
 * Centralized validation schemas for all API endpoints.
 * These schemas ensure type safety and input validation.
 */

import { z } from 'zod';

// ============================================
// Common Schemas
// ============================================

/**
 * Schema for resource names (databases, buckets, etc.)
 * - Only alphanumeric, underscores, and hyphens
 * - Minimum 1 character, maximum 64 characters
 */
export const resourceNameSchema = z.string()
  .min(1, 'Name is required')
  .max(64, 'Name must be 64 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Name can only contain letters, numbers, underscores, and hyphens');

/**
 * Schema for document keys
 * - Minimum 1 character, maximum 1024 characters
 * - No null bytes allowed
 */
export const documentKeySchema = z.string()
  .min(1, 'Document key is required')
  .max(1024, 'Document key must be 1024 characters or less')
  .refine(key => !key.includes('\0'), 'Document key must not contain null bytes');

/**
 * Schema for file keys
 * - Minimum 1 character, maximum 512 characters
 * - No path traversal sequences
 */
export const fileKeySchema = z.string()
  .min(1, 'File key is required')
  .max(512, 'File key must be 512 characters or less')
  .refine(key => !key.includes('..'), 'File key must not contain path traversal sequences (..)')
  .refine(key => !key.startsWith('/'), 'File key must not start with a slash')
  .refine(key => !key.includes('\0'), 'File key must not contain null bytes');

/**
 * Schema for positive integers
 */
export const positiveIntSchema = z.number()
  .int('Must be an integer')
  .positive('Must be positive');

/**
 * Schema for limit parameters (with max cap)
 */
export const limitSchema = z.number()
  .int('Limit must be an integer')
  .positive('Limit must be positive')
  .max(10000, 'Limit cannot exceed 10000');

// ============================================
// Data API Schemas
// ============================================

/**
 * Schema for database name (URL parameter)
 */
export const dbNameParamSchema = z.object({
  db: resourceNameSchema
});

/**
 * Schema for document creation request body
 */
export const createDocBodySchema = z.object({
  key: documentKeySchema,
  value: z.any().refine(v => v !== undefined, 'Document value is required')
});

/**
 * Schema for document update request body
 */
export const updateDocBodySchema = z.object({
  value: z.any().refine(v => v !== undefined, 'Document value is required')
});

/**
 * Schema for document key (URL parameter)
 */
export const docKeyParamSchema = z.object({
  db: resourceNameSchema,
  id: documentKeySchema
});

/**
 * Schema for list documents query parameters
 */
export const listDocsQuerySchema = z.object({
  startKey: z.string().optional(),
  endKey: z.string().optional(),
  limit: limitSchema.optional(),
  prefix: z.string().optional()
});

// ============================================
// Storage API Schemas
// ============================================

/**
 * Schema for bucket name (URL parameter)
 */
export const bucketNameParamSchema = z.object({
  bucket: resourceNameSchema
});

/**
 * Schema for file key (URL parameter)
 */
export const fileKeyParamSchema = z.object({
  bucket: resourceNameSchema,
  key: fileKeySchema
});

/**
 * Schema for list files query parameters
 */
export const listFilesQuerySchema = z.object({
  prefix: z.string().optional(),
  limit: limitSchema.optional()
});

// ============================================
// Auth API Schemas
// ============================================

/**
 * Schema for API key generation request body
 */
export const generateKeyBodySchema = z.object({
  name: z.string()
    .min(1, 'Name must be at least 1 character')
    .max(100, 'Name must be 100 characters or less')
    .optional()
});

/**
 * Schema for API key validation request body
 */
export const validateKeyBodySchema = z.object({
  key: z.string()
    .min(1, 'API key is required')
    .max(512, 'API key is too long')
});

/**
 * Schema for API key ID (URL parameter)
 */
export const keyIdParamSchema = z.object({
  id: z.string()
    .min(1, 'Key ID is required')
    .max(64, 'Key ID is too long')
});

// ============================================
// Validation Helper Functions
// ============================================

/**
 * Validates data against a Zod schema.
 * Returns the parsed data or throws with validation error details.
 * 
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Parsed and validated data
 * @throws ZodError if validation fails
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safely validates data, returning success/error object.
 * Useful in API handlers to convert validation errors to 400 responses.
 * 
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Object with success status and data or error
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>, 
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  // Format error message
  const errors = result.error.errors.map(e => {
    const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
    return `${path}${e.message}`;
  }).join('; ');
  
  return { success: false, error: errors };
}