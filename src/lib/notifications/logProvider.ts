import type {
  NotificationMessage,
  NotificationProvider,
} from "./provider";
import { logger } from "../logger";

export class LogNotificationProvider implements NotificationProvider {
  async send(message: NotificationMessage): Promise<void> {
    logger.info({
      notificationId: message.notificationId,
      centerId: message.centerId,
      jobId: message.jobId,
      jobName: message.jobName,
    }, "TutorDesk fee reminder notification");
  }
}
