import { z } from "zod";

export const MAX_REGIONS = 2048;
export const MAX_TAGS = 256;
export const textSchema = z.string().max(65_536);
