export type NotificationMessage = {
  notificationId: string;
  centerId: string;
  studentId: string;
  parentUserId: string | null;
  payload: Record<string, unknown>;
  jobId: string;
  jobName: string;
};

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<void>;
}
