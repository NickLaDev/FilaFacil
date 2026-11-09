import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { MyReviewDto, RestaurantReviewsDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { ToNumber, Trim } from '../../common/validation/transforms.js';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ReviewsService } from './reviews.service.js';

class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

class ReviewsQueryDto {
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@ApiTags('Avaliações (cliente)')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('orders/:orderId/review')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Avalia um pedido entregue com nota de 1 a 5 e comentário (ficha 48)' })
  @ApiErrors(400, 401, 404, 409, 422)
  create(@CurrentAuth() auth: AuthContext, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: CreateReviewDto): Promise<MyReviewDto> {
    return this.reviews.create(auth.userId, orderId, dto);
  }

  @Public()
  @Get('restaurants/:id/reviews')
  @ApiOperation({ summary: 'Nota média, distribuição e avaliações recentes do restaurante' })
  @ApiErrors(404)
  list(@Param('id', ParseUUIDPipe) id: string, @Query() query: ReviewsQueryDto): Promise<RestaurantReviewsDto> {
    return this.reviews.forRestaurant(id, query.limit);
  }
}
