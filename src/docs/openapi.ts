import { env } from "../config/env";
import { z } from "zod";
import * as authSchemas from "../modules/auth/schemas";
import * as batchSchemas from "../modules/batches/schemas";
import * as attendanceSchemas from "../modules/attendance/schemas";
import * as examSchemas from "../modules/exams/schemas";
import * as feePlanSchemas from "../modules/fee-plans/schemas";
import * as feeSchemas from "../modules/fees/schemas";
import * as inviteSchemas from "../modules/invites/schemas";
import * as memberSchemas from "../modules/members/schemas";
import * as paymentSchemas from "../modules/payments/schemas";
import * as planSchemas from "../modules/plan/schemas";
import * as studentSchemas from "../modules/students/schemas";

type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete";

type QueryParameter = {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
};

type OperationDefinition = {
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  authenticated?: boolean;
  requestBody?: boolean;
  successStatus: 200 | 201 | 202 | 204;
  query?: QueryParameter[];
  headers?: QueryParameter[];
};

const pageParameters: QueryParameter[] = [
  {
    name: "limit",
    description: "Page size (1-100; default 50).",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  {
    name: "offset",
    description: "Number of records to skip (default 0).",
    schema: { type: "integer", minimum: 0, default: 0 },
  },
];

const dateParameter = (name: string): QueryParameter => ({
  name,
  schema: { type: "string", format: "date" },
});

const operations: OperationDefinition[] = [
  { method: "get", path: "/health", tag: "System", summary: "Check process liveness", authenticated: false, successStatus: 200 },
  { method: "get", path: "/ready", tag: "System", summary: "Check database and Redis readiness", authenticated: false, successStatus: 200 },
  { method: "get", path: "/me", tag: "Authentication", summary: "Get the current user and center", successStatus: 200 },
  { method: "post", path: "/auth/signup-center", tag: "Authentication", summary: "Create an owner account and center", authenticated: false, requestBody: true, successStatus: 201 },
  { method: "post", path: "/auth/login", tag: "Authentication", summary: "Authenticate and receive a selection token or access token", authenticated: false, requestBody: true, successStatus: 200 },
  { method: "post", path: "/auth/select-center", tag: "Authentication", summary: "Select a center and receive an access token", authenticated: false, requestBody: true, successStatus: 200 },
  { method: "post", path: "/auth/accept-invite", tag: "Authentication", summary: "Accept a membership invitation", authenticated: false, requestBody: true, successStatus: 200 },
  { method: "post", path: "/students", tag: "Students", summary: "Create a student", requestBody: true, successStatus: 201 },
  { method: "get", path: "/students", tag: "Students", summary: "List students", query: pageParameters, successStatus: 200 },
  { method: "get", path: "/students/{id}", tag: "Students", summary: "Get a student", successStatus: 200 },
  { method: "patch", path: "/students/{id}", tag: "Students", summary: "Update a student", requestBody: true, successStatus: 200 },
  { method: "delete", path: "/students/{id}", tag: "Students", summary: "Delete a student", successStatus: 204 },
  { method: "post", path: "/students/{id}/fees", tag: "Fees", summary: "Assign a fee plan to a student", requestBody: true, successStatus: 201 },
  { method: "get", path: "/students/{id}/fees", tag: "Fees", summary: "List a student's fee-plan assignments", successStatus: 200 },
  { method: "get", path: "/students/{id}/dues", tag: "Fees", summary: "Get a student's dues", successStatus: 200 },
  { method: "patch", path: "/students/{id}/fees/{studentFeeId}", tag: "Fees", summary: "Update a student fee assignment", requestBody: true, successStatus: 200 },
  { method: "delete", path: "/students/{id}/fees/{studentFeeId}", tag: "Fees", summary: "Remove a student fee assignment", successStatus: 200 },
  { method: "post", path: "/invites", tag: "Memberships", summary: "Invite a member", requestBody: true, successStatus: 201 },
  { method: "get", path: "/invites", tag: "Memberships", summary: "List invitations", successStatus: 200 },
  { method: "delete", path: "/invites/{id}", tag: "Memberships", summary: "Revoke an invitation", successStatus: 204 },
  { method: "get", path: "/members", tag: "Memberships", summary: "List center members", successStatus: 200 },
  { method: "patch", path: "/members/{userId}", tag: "Memberships", summary: "Update a member", requestBody: true, successStatus: 200 },
  { method: "delete", path: "/members/{userId}", tag: "Memberships", summary: "Remove a member", successStatus: 204 },
  { method: "post", path: "/batches", tag: "Batches", summary: "Create a batch", requestBody: true, successStatus: 201 },
  { method: "get", path: "/batches", tag: "Batches", summary: "List batches visible to the current member", query: pageParameters, successStatus: 200 },
  { method: "get", path: "/batches/{id}", tag: "Batches", summary: "Get a batch", successStatus: 200 },
  { method: "patch", path: "/batches/{id}", tag: "Batches", summary: "Update a batch", requestBody: true, successStatus: 200 },
  { method: "delete", path: "/batches/{id}", tag: "Batches", summary: "Delete a batch", successStatus: 204 },
  { method: "put", path: "/batches/{id}/teachers", tag: "Batches", summary: "Replace a batch's assigned teachers", requestBody: true, successStatus: 200 },
  { method: "get", path: "/batches/{id}/teachers", tag: "Batches", summary: "List a batch's teachers", successStatus: 200 },
  { method: "post", path: "/batches/{id}/students", tag: "Batches", summary: "Enroll students in a batch", requestBody: true, successStatus: 200 },
  { method: "get", path: "/batches/{id}/students", tag: "Batches", summary: "List students enrolled in a batch", successStatus: 200 },
  { method: "delete", path: "/batches/{id}/students/{studentId}", tag: "Batches", summary: "Unenroll a student from a batch", successStatus: 204 },
  { method: "put", path: "/batches/{id}/attendance", tag: "Attendance", summary: "Mark or update batch attendance", requestBody: true, successStatus: 200 },
  { method: "get", path: "/batches/{id}/attendance", tag: "Attendance", summary: "Get a batch attendance roster", query: [{ name: "date", schema: { type: "string", format: "date" } }], successStatus: 200 },
  { method: "get", path: "/students/{id}/attendance", tag: "Attendance", summary: "Get a student's attendance history", query: [dateParameter("from"), dateParameter("to")], successStatus: 200 },
  { method: "post", path: "/batches/{id}/exams", tag: "Exams", summary: "Create an exam", requestBody: true, successStatus: 201 },
  { method: "get", path: "/batches/{id}/exams", tag: "Exams", summary: "List batch exams", successStatus: 200 },
  { method: "get", path: "/exams/{id}", tag: "Exams", summary: "Get an exam", successStatus: 200 },
  { method: "patch", path: "/exams/{id}", tag: "Exams", summary: "Update an exam", requestBody: true, successStatus: 200 },
  { method: "delete", path: "/exams/{id}", tag: "Exams", summary: "Delete an exam", successStatus: 204 },
  { method: "put", path: "/exams/{id}/results", tag: "Exams", summary: "Enter or update exam results", requestBody: true, successStatus: 200 },
  { method: "get", path: "/exams/{id}/results", tag: "Exams", summary: "Get an exam result roster and summary", successStatus: 200 },
  { method: "get", path: "/students/{id}/results", tag: "Exams", summary: "Get a student's exam history", successStatus: 200 },
  { method: "post", path: "/fee-plans", tag: "Fees", summary: "Create a fee plan", requestBody: true, successStatus: 201 },
  { method: "get", path: "/fee-plans", tag: "Fees", summary: "List fee plans", query: pageParameters, successStatus: 200 },
  { method: "get", path: "/fee-plans/{id}", tag: "Fees", summary: "Get a fee plan", successStatus: 200 },
  { method: "patch", path: "/fee-plans/{id}", tag: "Fees", summary: "Update a fee plan", requestBody: true, successStatus: 200 },
  { method: "delete", path: "/fee-plans/{id}", tag: "Fees", summary: "Delete a fee plan", successStatus: 204 },
  { method: "get", path: "/fees/dues/summary", tag: "Fees", summary: "Get a paginated dues summary", query: [{ name: "batchId", schema: { type: "string", format: "uuid" } }, ...pageParameters], successStatus: 200 },
  { method: "get", path: "/fees/overdue", tag: "Fees", summary: "List overdue students", query: [{ name: "sort", schema: { type: "string", enum: ["amount", "age"], default: "amount" } }, ...pageParameters], successStatus: 200 },
  { method: "post", path: "/fees/charges/generate", tag: "Fees", summary: "Generate charges for a month", requestBody: true, successStatus: 200 },
  { method: "patch", path: "/fees/charges/{id}/waive", tag: "Fees", summary: "Waive a fee charge", requestBody: true, successStatus: 200 },
  { method: "post", path: "/fees/charges/{id}/unwaive", tag: "Fees", summary: "Reverse a fee waiver", successStatus: 200 },
  { method: "post", path: "/payments", tag: "Payments", summary: "Create a payment", requestBody: true, headers: [{ name: "Idempotency-Key", description: "Required key used to safely replay payment requests.", schema: { type: "string", minLength: 1, maxLength: 128 } }], successStatus: 201 },
  { method: "get", path: "/payments", tag: "Payments", summary: "List payments", query: [{ name: "studentId", schema: { type: "string", format: "uuid" } }, dateParameter("from"), dateParameter("to"), { name: "method", schema: { type: "string", enum: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"] } }, { name: "includeVoided", schema: { type: "boolean", default: false } }, ...pageParameters], successStatus: 200 },
  { method: "get", path: "/payments/{id}", tag: "Payments", summary: "Get a payment receipt", successStatus: 200 },
  { method: "post", path: "/payments/{id}/void", tag: "Payments", summary: "Void a payment", requestBody: true, successStatus: 200 },
  { method: "get", path: "/parent/children", tag: "Parent view", summary: "List the parent's linked children and batches", successStatus: 200 },
  { method: "get", path: "/parent/children/{studentId}", tag: "Parent view", summary: "Get a linked child's overview", successStatus: 200 },
  { method: "get", path: "/parent/children/{studentId}/attendance", tag: "Parent view", summary: "Get linked-child attendance", query: [...[dateParameter("from"), dateParameter("to")], ...pageParameters], successStatus: 200 },
  { method: "get", path: "/parent/children/{studentId}/results", tag: "Parent view", summary: "Get linked-child exam results", successStatus: 200 },
  { method: "get", path: "/parent/children/{studentId}/dues", tag: "Parent view", summary: "Get linked-child fee dues", successStatus: 200 },
  { method: "get", path: "/parent/children/{studentId}/payments", tag: "Parent view", summary: "List linked-child payments", query: pageParameters, successStatus: 200 },
  { method: "get", path: "/parent/children/{studentId}/payments/{paymentId}", tag: "Parent view", summary: "Get a linked-child payment receipt", successStatus: 200 },
  { method: "get", path: "/plan", tag: "Plan", summary: "Get the current center plan", successStatus: 200 },
  { method: "patch", path: "/plan", tag: "Plan", summary: "Change the current center plan", requestBody: true, successStatus: 200 },
  { method: "get", path: "/notifications", tag: "Notifications", summary: "List center notifications", query: pageParameters, successStatus: 200 },
  { method: "post", path: "/jobs/run-now", tag: "Jobs", summary: "Request immediate scheduled jobs", successStatus: 202 },
  { method: "get", path: "/audit-logs", tag: "Audit", summary: "List center audit records", query: [{ name: "action", schema: { type: "string" } }, { name: "entityType", schema: { type: "string" } }, { name: "entityId", schema: { type: "string" } }, { name: "actorUserId", schema: { type: "string", format: "uuid" } }, dateParameter("from"), dateParameter("to"), ...pageParameters], successStatus: 200 },
];

const requestSchemas: Record<string, z.ZodType> = {
  "POST /auth/signup-center": authSchemas.signupCenterSchema,
  "POST /auth/login": authSchemas.loginSchema,
  "POST /auth/select-center": authSchemas.selectCenterSchema,
  "POST /auth/accept-invite": authSchemas.acceptInviteSchema,
  "POST /students": studentSchemas.createStudentSchema,
  "PATCH /students/{id}": studentSchemas.updateStudentSchema,
  "POST /students/{id}/fees": feeSchemas.createStudentFeeSchema,
  "PATCH /students/{id}/fees/{studentFeeId}": feeSchemas.updateStudentFeeSchema,
  "POST /invites": inviteSchemas.createInviteSchema,
  "PATCH /members/{userId}": memberSchemas.updateMemberSchema,
  "POST /batches": batchSchemas.createBatchSchema,
  "PATCH /batches/{id}": batchSchemas.updateBatchSchema,
  "PUT /batches/{id}/teachers": batchSchemas.setBatchTeachersSchema,
  "POST /batches/{id}/students": batchSchemas.enrollStudentsSchema,
  "PUT /batches/{id}/attendance": attendanceSchemas.upsertAttendanceSchema,
  "POST /batches/{id}/exams": examSchemas.createExamSchema,
  "PATCH /exams/{id}": examSchemas.updateExamSchema,
  "PUT /exams/{id}/results": examSchemas.upsertExamResultsSchema,
  "POST /fee-plans": feePlanSchemas.createFeePlanSchema,
  "PATCH /fee-plans/{id}": feePlanSchemas.updateFeePlanSchema,
  "POST /fees/charges/generate": feeSchemas.generateChargesSchema,
  "PATCH /fees/charges/{id}/waive": feeSchemas.waiveFeeChargeSchema,
  "POST /payments": paymentSchemas.createPaymentSchema,
  "POST /payments/{id}/void": paymentSchemas.voidPaymentSchema,
  "PATCH /plan": planSchemas.updatePlanSchema,
};

const genericResponse = {
  description: "Successful response.",
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: true },
    },
  },
};

const errorResponse = {
  description: "Request failed.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
};

const paths: Record<string, Record<string, unknown>> = {};
for (const definition of operations) {
  const pathItem = paths[definition.path] ?? {};
  const operationKey = `${definition.method.toUpperCase()} ${definition.path}`;
  const requestSchema = requestSchemas[operationKey];
  if (definition.requestBody && !requestSchema) {
    throw new Error(`Missing OpenAPI request schema for ${operationKey}`);
  }
  const parameters = [
    ...[...definition.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    })),
    ...(definition.query ?? []).map((parameter) => ({
      ...parameter,
      in: "query",
      required: false,
    })),
    ...(definition.headers ?? []).map((parameter) => ({
      ...parameter,
      in: "header",
      required: true,
    })),
  ];
  const responses: Record<string, unknown> = {
    [definition.successStatus]: definition.successStatus === 204
      ? { description: "The operation completed successfully." }
      : genericResponse,
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    429: errorResponse,
    500: errorResponse,
  };
  pathItem[definition.method] = {
    tags: [definition.tag],
    summary: definition.summary,
    operationId: `${definition.method}_${definition.path
      .replace(/[{}]/g, "")
      .replaceAll("/", "_")
      .replace(/^_/, "")}`,
    ...(definition.authenticated === false
      ? {}
      : { security: [{ bearerAuth: [] }] }),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(definition.requestBody && requestSchema
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  ...z.toJSONSchema(requestSchema, {
                    target: "openapi-3.1",
                    unrepresentable: "any",
                  }),
                },
              },
            },
          },
        }
      : {}),
    responses,
  };
  paths[definition.path] = pathItem;
}

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "TutorDesk API",
    version: "1.0.0",
    description:
      "Multi-tenant tuition-center API. Tenant and role access are derived from the authenticated membership.",
  },
  servers: [{ url: env.APP_URL }],
  tags: [
    { name: "System" },
    { name: "Authentication" },
    { name: "Students" },
    { name: "Memberships" },
    { name: "Batches" },
    { name: "Attendance" },
    { name: "Exams" },
    { name: "Fees" },
    { name: "Payments" },
    { name: "Parent view" },
    { name: "Plan" },
    { name: "Notifications" },
    { name: "Jobs" },
    { name: "Audit" },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
