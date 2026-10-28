REVOKE DELETE ON TABLE "Payment", "PaymentAllocation" FROM tutordesk_app;

ALTER DEFAULT PRIVILEGES FOR ROLE tutordesk IN SCHEMA public
    REVOKE DELETE ON TABLES FROM tutordesk_app;
