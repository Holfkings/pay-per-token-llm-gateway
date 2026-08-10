import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { stellarAddressSchema } from '@x402/validation';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

@ApiTags('auth')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Get a challenge for wallet-based authentication.
   * The client signs this challenge with their Stellar private key
   * and submits the signature to /auth/verify.
   */
  @Post('challenge')
  @ApiOperation({ summary: 'Request an authentication challenge' })
  createChallenge(@Body('address') address: string) {
    const parsed = stellarAddressSchema.safeParse(address);
    if (!parsed.success) {
      throw new BadRequestException('Invalid Stellar wallet address');
    }

    return this.authService.createChallenge(parsed.data);
  }

  /**
   * Verify a signed challenge and receive a JWT session token.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a signed challenge and get a session token' })
  async verifyChallenge(
    @Body('challengeId') challengeId: string,
    @Body('address') address: string,
    @Body('signature') signature: string,
  ) {
    if (!challengeId || !address || !signature) {
      throw new BadRequestException('challengeId, address, and signature are required');
    }

    const result = await this.authService.verifyChallenge(challengeId, address, signature);

    if (!result.verified) {
      throw new UnauthorizedException(result.error);
    }

    return { token: result.token };
  }

  /**
   * Validate the current session token.
   * Returns the wallet address if valid.
   */
  @Get('session')
  @ApiOperation({ summary: 'Validate current session' })
  async validateSession(@Headers('authorization') authHeader: string) {
    const token = this.extractToken(authHeader);
    const result = await this.authService.validateToken(token);

    if (!result.valid) {
      throw new UnauthorizedException(result.error);
    }

    return {
      address: result.address,
      sessionId: result.sessionId,
    };
  }

  /**
   * End the current session (logout).
   */
  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End current session (logout)' })
  async destroySession(@Headers('authorization') authHeader: string) {
    const token = this.extractToken(authHeader);
    const result = await this.authService.validateToken(token);

    if (!result.valid) {
      throw new UnauthorizedException(result.error);
    }

    if (result.sessionId) {
      this.authService.destroySession(result.sessionId);
    }
  }

  private extractToken(authHeader: string): string {
    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Invalid authorization format. Use: Bearer <token>');
    }

    return parts[1];
  }
}
