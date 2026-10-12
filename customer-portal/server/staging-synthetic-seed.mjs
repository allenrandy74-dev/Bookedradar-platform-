// Called only while creating the new, approved staging schema, inside its transaction.
// Fixed synthetic rows only. No identity bindings, sessions, grants or active members.
export async function seedNewStagingSchema(client){
  await client.query(`INSERT INTO bookedradar_portal_staging.tenants (id,name,active) VALUES ('portal-staging-demo','BookedRadar Synthetic Pilot',false),('portal-staging-other','Synthetic Other Tenant',false)`);
  await client.query(`INSERT INTO bookedradar_portal_staging.memberships (tenant_id,id,user_id,name,role,active) VALUES ('portal-staging-demo','owner-pilot','staging-owner-pilot','Owner test login','operator',false),('portal-staging-other','other-pilot','staging-other-pilot','Other synthetic member','operator',false)`);
  await client.query(`INSERT INTO bookedradar_portal_staging.inquiries (tenant_id,id,customer_name,contact_email,contact_phone,subject,summary,source,received_at,updated_at) VALUES
    ('portal-staging-demo','synthetic-inquiry-1','Synthetic Jordan','jordan@example.test','','Synthetic repair inquiry','Synthetic fixture for testing internal status and notes.','synthetic',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
    ('portal-staging-demo','synthetic-inquiry-2','Synthetic Morgan','morgan@example.test','','Synthetic callback inquiry','No customer contact or booking action is connected.','synthetic',CURRENT_TIMESTAMP-INTERVAL '1 hour',CURRENT_TIMESTAMP),
    ('portal-staging-other','synthetic-inquiry-1','Synthetic Other','other@example.test','','Other-tenant isolation fixture','This record must never appear in the owner pilot tenant.','synthetic',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
}
