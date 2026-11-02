import { z } from 'zod';
import { DIVISIONS } from '../../integration/combine.mjs';

const divisionNames = DIVISIONS.map(({ division }) => division);
const division = z.enum(divisionNames);
const isoDate = z.iso.date();
const temperature = z.number().min(-60).max(60).nullable();

export const holidaysQuery = z.strictObject({
  division: division.default('england-and-wales'),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  from: isoDate.optional(),
});

export const countryCode = z.string().regex(/^[A-Za-z]{2}$/, 'must be a two-letter ISO 3166 code').toUpperCase();

const weather = z.strictObject({
  source: z.enum(['forecast', 'climate', 'seasonal', 'unavailable']),
  tempMaxC: temperature,
  tempMinC: temperature,
  precipMm: z.number().min(0).max(1000).nullable(),
  rainChancePct: z.number().min(0).max(100).nullable(),
  weatherCode: z.number().int().min(0).max(99).nullable(),
});

export const snapshot = z.strictObject({
  generatedAt: z.iso.datetime(),
  failedSources: z.array(z.string().max(64)).max(9),
  divisions: z
    .array(
      z.strictObject({
        division,
        label: z.string().max(64),
        location: z.strictObject({ name: z.string().max(64), latitude: z.number(), longitude: z.number() }),
        holidays: z
          .array(
            z.strictObject({
              date: isoDate,
              title: z.string().min(1).max(120),
              notes: z.string().max(120),
              bunting: z.boolean(),
              weather,
            }),
          )
          .max(10),
      }),
    )
    .length(divisionNames.length),
});
