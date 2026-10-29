import type {
  NotificationMessage,
  NotificationProvider,
} from "./provider";

export class LogNotificationProvider implements NotificationProvider {
  async send(message: NotificationMessage): Promise<void> {
    console.info("TutorDesk fee reminder notification", {
      notificationId: message.notificationId,
      centerId: message.centerId,
      studentId: message.studentId,
      parentUserId: message.parentUserId,
      payload: message.payload,
    });
  }
}
