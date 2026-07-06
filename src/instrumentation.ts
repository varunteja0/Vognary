import type { Instrumentation } from "next";
import { reportServerError } from "@/lib/server/monitoring";

export function register() {}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await reportServerError(error, request, context);
};