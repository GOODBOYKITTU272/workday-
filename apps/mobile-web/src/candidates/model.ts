import type { AppRole } from "../auth/model";

export type CandidateStatus = "active" | "inactive" | "archived";

export type CandidateRecord = {
  id: string;
  created_by: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  location: string | null;
  target_role: string | null;
  years_experience: number | null;
  status: CandidateStatus;
  created_at: string;
  updated_at: string;
};

export type CandidateInput = {
  email: string;
  full_name: string;
  location?: string;
  phone?: string;
  status?: CandidateStatus;
  target_role?: string;
  years_experience?: string;
};

export type CandidateValidationErrors = Partial<Record<keyof CandidateInput, string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canManageCandidates(role: AppRole | null | undefined) {
  return role === "admin" || role === "operator";
}

export function validateCandidateInput(input: Pick<CandidateInput, "email" | "full_name"> & Partial<CandidateInput>) {
  const errors: CandidateValidationErrors = {};
  const email = input.email.trim();

  if (!input.full_name.trim()) {
    errors.full_name = "Name is required.";
  }

  if (!email) {
    errors.email = "Email is required.";
  } else if (!emailPattern.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (input.years_experience?.trim()) {
    const years = Number(input.years_experience);

    if (!Number.isFinite(years) || years < 0) {
      errors.years_experience = "Enter zero or more years.";
    }
  }

  return errors;
}

export function toCandidatePayload(input: CandidateInput, createdBy?: string | null) {
  const years = input.years_experience?.trim() ? Number(input.years_experience) : null;

  return {
    ...(createdBy === undefined ? {} : { created_by: createdBy }),
    email: input.email.trim().toLowerCase(),
    full_name: input.full_name.trim(),
    location: input.location?.trim() || null,
    phone: input.phone?.trim() || null,
    status: input.status ?? "active",
    target_role: input.target_role?.trim() || null,
    years_experience: years
  };
}
