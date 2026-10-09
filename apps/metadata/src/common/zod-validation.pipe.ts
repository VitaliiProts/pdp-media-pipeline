import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { type MetadataErrorBody } from '@pdp/contracts';
import { z } from 'zod';

/** Validates internal API input against the shared contracts in `@pdp/contracts`. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const body: MetadataErrorBody = {
        code: 'VALIDATION_FAILED',
        message: z.prettifyError(result.error),
      };
      throw new BadRequestException(body);
    }
    return result.data;
  }
}
