import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Page } from '@filafacil/shared';
import { ToNumber } from '../validation/transforms.js';

export const MAX_PAGE_SIZE = 100;

export class PageQueryDto {
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize = 20;
}

export const pageArgs = ({ page, pageSize }: PageQueryDto) => ({ skip: (page - 1) * pageSize, take: pageSize });

export const toPage = <T>(items: T[], total: number, { page, pageSize }: PageQueryDto): Page<T> => ({ items, page, pageSize, total });
