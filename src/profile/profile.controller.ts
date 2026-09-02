import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { NyscStatus, OpenToWorkStatus } from '@prisma/client';
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
  @IsOptional() @IsEnum(OpenToWorkStatus) openToWork?: OpenToWorkStatus;
  @IsOptional() @IsInt() @Min(0) salaryExpectationMin?: number;
  @IsOptional() @IsString() salaryCurrency?: string;
  @IsOptional() @IsString() preferredWorkMode?: string;
  @IsOptional() @IsString() availabilityDate?: string;
  @IsOptional() @IsString() educationLevel?: string;
  @IsOptional() @IsString() schoolName?: string;
  @IsOptional() @IsInt() graduationYear?: number;
  @IsOptional() @IsEnum(NyscStatus) nyscStatus?: NyscStatus;
}

class JobPreferenceDto {
  @IsOptional() @IsArray() roleFamilies?: string[];
  @IsOptional() @IsArray() locations?: string[];
  @IsOptional() @IsArray() workModes?: string[];
  @IsOptional() @IsInt() @Min(0) salaryFloor?: number;
  @IsOptional() @IsBoolean() nyscOrEntry?: boolean;
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

  @Patch('preferences')
  preferences(@Req() req: any, @Body() dto: JobPreferenceDto) {
    return this.profile.updatePreferences(req.candidate.id, dto);
  }

  @Post('cv')
  uploadCv(@Req() req: any, @Body() dto: UploadCvDto) {
    return this.profile.uploadCv(req.candidate.id, dto);
  }

  @Post('cv/file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadCvFile(
    @Req() req: any,
    @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    return this.profile.uploadCvFile(req.candidate.id, file);
  }
}
