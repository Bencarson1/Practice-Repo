# Wearvia — current Supabase database (exported 24 Sept 2026)

Project URL: https://ylngxdwywqteanpelsqb.supabase.co

This is the live layout of the existing Supabase project. Fabric is sold by the yard: the fabric columns were renamed from metres to yards by `wearvia/supabase/yards.sql` (price_per_metre → price_per_yard, metres_available → yards_available, min_order_metres → min_order_yards, fabric_metres → fabric_yards), and the names below are the new ones. Build on it — do not drop or recreate these tables. Add new columns/tables with `alter table ... add column if not exists` / `create table if not exists`.

Existing helper functions used by policies: `is_admin()`, `can_manage_designer(designer_id)`, `can_manage_supplier(supplier_id)`. Enums: `user_role` (includes 'designer_owner', 'supplier', admin, and presumably customer — check with `select enum_range(null::user_role)`), `order_stage` (includes 'delivered').

## Tables

- **customers**: id uuid, auth_user_id uuid, name text, email text, phone text, created_at timestamp with time zone
- **deliveries**: id uuid, order_id uuid, courier text, tracking_number text, status text, eta date, created_at timestamp with time zone
- **designer_portfolio_items**: id uuid, designer_id uuid, image_url text, caption text, sort_order integer, created_at timestamp with time zone, title text, description text, outfit_category text, starting_price numeric
- **designer_ratings**: designer_id uuid, avg_rating numeric, review_count integer
- **designer_services**: id uuid, designer_id uuid, name text, description text, price numeric, created_at timestamp with time zone
- **designer_staff**: id uuid, designer_id uuid, user_id uuid, job_role text, created_at timestamp with time zone
- **designers**: id uuid, business_name text, location text, rating numeric, speciality_tags ARRAY, commission_rate numeric, created_at timestamp with time zone, owner_user_id uuid, approved boolean, profile_image_url text, description text, starting_price numeric, delivery_estimate text
- **fabrics**: id uuid, supplier_id uuid, name text, category text, price_per_yard numeric, yards_available numeric, min_order_yards numeric, created_at timestamp with time zone
- **invoices**: id uuid, order_id uuid, line_items jsonb, total numeric, created_at timestamp with time zone
- **measurement_profiles**: id uuid, customer_id uuid, label text, chest numeric, waist numeric, shoulder numeric, sleeve numeric, trouser_length numeric, neck numeric, created_at timestamp with time zone, hip numeric, thigh numeric, inseam numeric, height numeric, notes text, is_default boolean, is_saved boolean, updated_at timestamp with time zone
- **order_events**: id uuid, order_id uuid, stage USER-DEFINED, note text, created_by uuid, created_at timestamp with time zone
- **orders**: id uuid, order_number text, customer_id uuid, designer_id uuid, outfit_type text, colour text, embroidery text, sleeve_style text, neck_style text, concept_image_url text, measurement_profile_id uuid, fabric_id uuid, fabric_yards numeric, fabric_cost numeric, tailoring_cost numeric, embroidery_cost numeric, delivery_cost numeric, quote_total numeric, deposit_amount numeric, deposit_paid_at timestamp with time zone, balance_paid_at timestamp with time zone, stage USER-DEFINED, assigned_cutting text, assigned_sewing text, assigned_embroidery text, assigned_finishing text, assigned_quality_control text, review_rating integer, review_text text, wedding_order_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone
- **profiles**: id uuid, email text, full_name text, role USER-DEFINED, created_at timestamp with time zone
- **reviews**: id uuid, order_id uuid, designer_id uuid, customer_id uuid, rating integer, review_text text, created_at timestamp with time zone
- **suppliers**: id uuid, name text, location text, delivery_estimate text, rating numeric, created_at timestamp with time zone, owner_user_id uuid
- **wedding_orders**: id uuid, designer_id uuid, event_name text, event_date date, created_at timestamp with time zone

## Row Level Security policies (table / name / command / using / with check)

- customers / customers read own row / SELECT / (auth.uid() = auth_user_id) / 
- customers / customers update own row / UPDATE / (auth.uid() = auth_user_id) / 
- measurement_profiles / customers read own measurement profiles / SELECT / (customer_id IN ( SELECT customers.id FROM customers WHERE (customers.auth_user_id = auth.uid()))) /
- measurement_profiles / customers manage own measurement profiles / ALL / (customer_id IN ( SELECT customers.id FROM customers WHERE (customers.auth_user_id = auth.uid()))) /
- orders / customers read own orders / SELECT / (customer_id IN ( SELECT customers.id FROM customers WHERE (customers.auth_user_id = auth.uid()))) /
- invoices / customers read own invoices / SELECT / (order_id IN ( SELECT o.id FROM (orders o JOIN customers c ON ((c.id = o.customer_id))) WHERE (c.auth_user_id = auth.uid()))) /
- deliveries / customers read own deliveries / SELECT / (order_id IN ( SELECT o.id FROM (orders o JOIN customers c ON ((c.id = o.customer_id))) WHERE (c.auth_user_id = auth.uid()))) /
- fabrics / fabrics public read / SELECT / true / 
- suppliers / suppliers public read / SELECT / true / 
- designers / designers public read / SELECT / true / 
- profiles / profiles: read own or admin / SELECT / ((id = auth.uid()) OR is_admin()) / 
- orders / orders: designer staff/owner/admin can update their orders / UPDATE / can_manage_designer(designer_id) / can_manage_designer(designer_id)
- profiles / profiles: read teammates on a shared designer / SELECT / (id IN ( SELECT designer_staff.user_id FROM designer_staff WHERE can_manage_designer(designer_staff.designer_id))) /
- profiles / profiles: update own or admin (role locked by trigger) / UPDATE / ((id = auth.uid()) OR is_admin()) / ((id = auth.uid()) OR is_admin())
- designer_staff / designer_staff: team can see their own roster / SELECT / can_manage_designer(designer_id) / 
- designer_staff / designer_staff: only the owner or admin can add/remove staff / INSERT / / ((EXISTS ( SELECT 1 FROM designers WHERE ((designers.id = designer_staff.designer_id) AND (designers.owner_user_id = auth.uid())))) OR is_admin())
- designer_staff / designer_staff: only the owner or admin can update staff rows / UPDATE / ((EXISTS ( SELECT 1 FROM designers WHERE ((designers.id = designer_staff.designer_id) AND (designers.owner_user_id = auth.uid())))) OR is_admin()) /
- designer_staff / designer_staff: only the owner or admin can remove staff / DELETE / ((EXISTS ( SELECT 1 FROM designers WHERE ((designers.id = designer_staff.designer_id) AND (designers.owner_user_id = auth.uid())))) OR is_admin()) /
- wedding_orders / wedding_orders: team read / SELECT / can_manage_designer(designer_id) / 
- designers / designers: owner can create their own designer row / INSERT / / ((owner_user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'designer_owner'::user_role)))))
- designers / designers: owner or admin can update their own designer row / UPDATE / ((owner_user_id = auth.uid()) OR is_admin()) / ((owner_user_id = auth.uid()) OR is_admin())
- suppliers / suppliers: owner can create their own supplier row / INSERT / / ((owner_user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supplier'::user_role)))))
- suppliers / suppliers: owner or admin can update their own supplier row / UPDATE / ((owner_user_id = auth.uid()) OR is_admin()) / ((owner_user_id = auth.uid()) OR is_admin())
- fabrics / fabrics: supplier manages own stock / INSERT / / can_manage_supplier(supplier_id)
- fabrics / fabrics: supplier updates own stock / UPDATE / can_manage_supplier(supplier_id) / can_manage_supplier(supplier_id)
- fabrics / fabrics: supplier deletes own stock / DELETE / can_manage_supplier(supplier_id) / 
- orders / orders: designer staff/owner/admin can read their orders / SELECT / can_manage_designer(designer_id) / 
- wedding_orders / wedding_orders: team create / INSERT / / can_manage_designer(designer_id)
- measurement_profiles / measurement_profiles: designer staff/owner/admin can read for t / SELECT / (id IN ( SELECT orders.measurement_profile_id FROM orders WHERE can_manage_designer(orders.designer_id))) /
- invoices / invoices: designer staff/owner/admin can read for their orders / SELECT / (order_id IN ( SELECT orders.id FROM orders WHERE can_manage_designer(orders.designer_id))) /
- deliveries / deliveries: designer staff/owner/admin can read for their order / SELECT / (order_id IN ( SELECT orders.id FROM orders WHERE can_manage_designer(orders.designer_id))) /
- deliveries / deliveries: designer staff/owner/admin can update for their ord / UPDATE / (order_id IN ( SELECT orders.id FROM orders WHERE can_manage_designer(orders.designer_id))) / (order_id IN ( SELECT orders.id FROM orders WHERE can_manage_designer(orders.designer_id)))
- wedding_orders / wedding_orders: team update / UPDATE / can_manage_designer(designer_id) / can_manage_designer(designer_id)
- wedding_orders / wedding_orders: team delete / DELETE / can_manage_designer(designer_id) / 
- order_events / order_events: customer reads own / SELECT / (order_id IN ( SELECT o.id FROM (orders o JOIN customers c ON ((c.id = o.customer_id))) WHERE (c.auth_user_id = auth.uid()))) /
- customers / customers: designer staff/owner/admin can read customers on the / SELECT / ((id IN ( SELECT orders.customer_id FROM orders WHERE can_manage_designer(orders.designer_id))) OR is_admin()) /
- designer_portfolio_items / designer_portfolio_items: public read / SELECT / true / 
- designer_portfolio_items / designer_portfolio_items: owner manages own / INSERT / / can_manage_designer(designer_id)
- designer_portfolio_items / designer_portfolio_items: owner updates own / UPDATE / can_manage_designer(designer_id) / can_manage_designer(designer_id)
- designer_portfolio_items / designer_portfolio_items: owner deletes own / DELETE / can_manage_designer(designer_id) / 
- designer_services / designer_services: public read / SELECT / true / 
- designer_services / designer_services: owner manages own / INSERT / / can_manage_designer(designer_id)
- designer_services / designer_services: owner updates own / UPDATE / can_manage_designer(designer_id) / can_manage_designer(designer_id)
- designer_services / designer_services: owner deletes own / DELETE / can_manage_designer(designer_id) / 
- reviews / reviews: public read / SELECT / true / 
- reviews / reviews: customer reviews own delivered order / INSERT / / ((customer_id IN ( SELECT customers.id FROM customers WHERE (customers.auth_user_id = auth.uid()))) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = reviews.order_id) AND (o.customer_id = reviews.customer_id) AND (o.designer_id = reviews.designer_id) AND (o.stage = 'delivered'::order_stage)))))
- reviews / reviews: admin moderates / ALL / is_admin() / is_admin()
- order_events / order_events: designer team reads own / SELECT / (order_id IN ( SELECT o.id FROM orders o WHERE can_manage_designer(o.designer_id))) /

## Row counts

- customers: 1
- deliveries: 0
- designer_portfolio_items: 0
- designer_services: 0
- designer_staff: 0
- designers: 1
- fabrics: 5
- invoices: 0
- measurement_profiles: 4
- order_events: 0
- orders: 0
- profiles: 1
- reviews: 0
- suppliers: 5
- wedding_orders: 0

## Gaps the app needs (found by comparing with the app in /wearvia)

- No INSERT policy on `orders` (customers can't place orders) and no INSERT policy on `customers` / `measurement_profiles` insert relies on the ALL policy.
- No `payments` table (deposit, balance, part payments, method, date).
- `fabrics` lacks: photos (array of storage paths), description, colour_name, status (pending/approved/hidden), sold_out, deleted_at, updated_at.
- `suppliers` lacks: phone, logo_url.
- `orders` lacks: inspiration photos (array of storage paths), inspiration_link, inspiration_note, concept_variation, due_date.
- No tables yet for: ready-to-wear items and sales, wedding order members, tailor team names (only `designer_staff` linked to auth users), fabric-seller order lines.
- No Storage buckets for fabric photos, seller logos, or customer style photos.
- Performance advisor warnings ("Auth RLS Initialization Plan"): policies call `auth.uid()` directly; wrap as `(select auth.uid())`.
- Security note: while payments are a demo, a customer's browser must not be able to mark an order paid or move production stages. Deposits/stages should only be settable by the designer team (or later by a Stripe webhook).
