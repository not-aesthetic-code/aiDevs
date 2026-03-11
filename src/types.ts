export const JOB_TAGS = [
  "IT",
  "transport",
  "edukacja",
  "medycyna",
  "praca z ludźmi",
  "praca z pojazdami",
  "praca fizyczna",
] as const;

export type JobTag = (typeof JOB_TAGS)[number];

export interface PersonRecord {
  name: string;
  surname: string;
  gender: string;
  born: number;
  city: string;
  job: string;
}

export interface PersonAnswer {
  name: string;
  surname: string;
  gender: string;
  born: number;
  city: string;
  tags: string[];
}

export interface VerifyPayload {
  apikey: string;
  task: "people";
  answer: PersonAnswer[];
}
