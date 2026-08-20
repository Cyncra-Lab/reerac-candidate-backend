import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';
import { ProfileService } from './profile.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

class UpdateProfileDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() linkedInUrl?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() roleInterest?: string;
  @IsOptional() @IsString() experienceLevel?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsArray() skills?: string[];
  @IsOptional() @IsInt() @Min(0) yearsExperience?: number;
}

class UploadCvDto {
  @IsString() @IsUrl({ require_tld: false }) url!: string;
  @IsString() fileName!: string;
}

@Controller('me')
@UseGuards(CandidateAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@Req() req: any) {
    return this.profile.get(req.candidate.id);
  }

  @Patch()
  update(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.profile.update(req.candidate.id, dto);
  }

  @Post('cv')
  uploadCv(@Req() req: any, @Body() dto: UploadCvDto) {
    return this.profile.uploadCv(req.candidate.id, dto);
  }
}
