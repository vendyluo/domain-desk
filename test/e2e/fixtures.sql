INSERT INTO domains(id,name) VALUES('domain:e2e','inquiries.example');
INSERT INTO products(id,domain_id,name) VALUES('product:e2e','domain:e2e','Field Notes');
INSERT INTO mailbox_identities(id,product_id,address,display_name) VALUES('mailbox:e2e','product:e2e','hello@inquiries.example','Product inquiries');

INSERT INTO contacts(id,display_name,created_at,primary_email_id) VALUES('contact:e2e','顾客 Ada','2026-08-24T09:00:00.000Z','email:e2e');
INSERT INTO contact_email_addresses(id,contact_id,address,created_at,first_seen_at) VALUES('email:e2e','contact:e2e','ada@customer.example','2026-08-24T09:00:00.000Z','2026-08-24T09:00:00.000Z');
INSERT INTO conversations(id,mailbox_identity_id,contact_id,subject,needs_attention,created_at,updated_at) VALUES('conversation:e2e','mailbox:e2e','contact:e2e','Pricing request — 年間契約',1,'2026-08-24T09:00:00.000Z','2026-08-25T10:30:00.000Z');
INSERT INTO messages(id,conversation_id,mailbox_identity_id,contact_id,dedupe_key,message_id,references_json,sender_address,sender_name,subject,text_body,sent_at,received_at,ingested_at) VALUES('message:e2e','conversation:e2e','mailbox:e2e','contact:e2e','message-id:e2e','browser-fixture@customer.example','[]','ada@customer.example','顾客 Ada','Pricing request — 年間契約','Hello,

Could you quote 25 seats? <script>alert("never render")</script>

Thanks.','2026-08-25T10:29:00.000Z','2026-08-25T10:30:00.000Z','2026-08-25T10:30:01.000Z');
INSERT INTO message_recipients(id,message_id,mailbox_identity_id,kind,address,display_name) VALUES('recipient:e2e','message:e2e','mailbox:e2e','to','hello@inquiries.example','Product inquiries');
INSERT INTO attachments(id,message_id,filename,media_type,size,content_hash,object_key,disposition) VALUES('attachment:e2e','message:e2e','quote requirements.txt','text/plain',__ATTACHMENT_SIZE__,'__ATTACHMENT_HASH__','attachments/__ATTACHMENT_HASH__','attachment');

INSERT INTO next_actions(id,description,due_at,status,source_type,source_id,contact_id,created_by,created_at) VALUES('action:e2e','Review seat pricing','2026-08-25T14:00:00.000Z','open','conversation','conversation:e2e','contact:e2e','owner','2026-08-25T11:00:00.000Z');
INSERT INTO opportunities(id,title,desired_outcome,contact_id,product_id,state,value_minor,currency,owner_actor,created_at,updated_at) VALUES('opportunity:e2e','Annual team plan','Agree an annual 25-seat subscription','contact:e2e','product:e2e','active',125000,'USD','owner','2026-08-25T11:00:00.000Z','2026-08-25T12:00:00.000Z');
INSERT INTO opportunity_contacts(opportunity_id,contact_id,created_at) VALUES('opportunity:e2e','contact:e2e','2026-08-25T11:00:00.000Z');
INSERT INTO opportunity_conversations(opportunity_id,conversation_id,product_id,mailbox_identity_id,domain_id,created_at) VALUES('opportunity:e2e','conversation:e2e','product:e2e','mailbox:e2e','domain:e2e','2026-08-25T11:00:00.000Z');
INSERT INTO next_actions(id,description,due_at,status,source_type,source_id,contact_id,created_by,created_at,opportunity_id,is_designated) VALUES('action:opportunity:e2e','Schedule technical review',NULL,'open','contact','contact:e2e','contact:e2e','owner','2026-08-25T12:00:00.000Z','opportunity:e2e',1);
INSERT INTO activity_events(id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,new_state_json) VALUES('event:e2e','opportunity.activated','owner','2026-08-25T12:00:00.000Z','opportunity','opportunity:e2e','contact:e2e','conversation','conversation:e2e','{"state":"active"}');
