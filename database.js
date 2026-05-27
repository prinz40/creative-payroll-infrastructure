// Database orchestration configuration using SQL schema layouts
const knex = require('knex')({
  client: 'pg', // PostgreSQL production infrastructure connector
    connection: {
        host: process.env.DB_HOST || '127.0.0.1',
            user: process.env.DB_USER || 'creativepay_admin',
                password: process.env.DB_PASSWORD || 'SecureInfrastructurePass123!',
                    database: process.env.DB_NAME || 'creativepay_ledger'
                      },
                        pool: { min: 2, max: 10 } // Allocates optimized traffic connection pooling
                        });

                        /**
                         * ARCHITECTURAL STEP: Programmatic Table Schemas
                          * Automatically initializes relational database architectures if absent on the production server.
                           */
                           async function initializeDatabaseSchema() {
                             try {
                                 // 1. Core Users and Creative Profiles Table Setup
                                     const hasUsersTable = await knex.schema.hasTable('users');
                                         if (!hasUsersTable) {
                                               await knex.schema.createTable('users', (table) => {
                                                       table.uuid('user_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
                                                               table.string('email').unique().notNullable();
                                                                       table.string('phone_number').notNullable(); // Vital node for mobile money API calls
                                                                               table.string('country_code').defaultTo('NG'); // Standard ISO routing flags (NG, GH, KE)
                                                                                       table.timestamp('created_at').defaultTo(knex.fn.now());
                                                                                             });
                                                                                                   console.log('[DATABASE ENGINE]: Users table infrastructure created successfully.');
                                                                                                       }

                                                                                                           // 2. Financial Invoices Ledger Table Setup
                                                                                                               const hasInvoicesTable = await knex.schema.hasTable('invoices');
                                                                                                                   if (!hasInvoicesTable) {
                                                                                                                         await knex.schema.createTable('invoices', (table) => {
                                                                                                                                 table.string('invoice_id').primary(); // Formatted String e.g. INV-102943
                                                                                                                                         table.uuid('creator_id').references('user_id').inTable('users').onDelete('CASCADE');
                                                                                                                                                 table.decimal('amount_usd', 14, 2).notNullable(); // Accurate decimal scaling for currency financial math
                                                                                                                                                         table.decimal('payout_fiat_estimated', 14, 2); 
                                                                                                                                                                 table.string('status').defaultTo('PENDING_PAYMENT'); // PENDING_PAYMENT -> CRYPTO_RECEIVED -> SETTLED_SUCCESSFULLY
                                                                                                                                                                         table.string('blockchain_tx_hash').nullable(); // Immutable on-chain ledger cross-reference
                                                                                                                                                                                 table.timestamp('issued_at').defaultTo(knex.fn.now());
                                                                                                                                                                                       });
                                                                                                                                                                                             console.log('[DATABASE ENGINE]: Invoices relational ledger table initialized.');
                                                                                                                                                                                                 }
                                                                                                                                                                                                   } catch (error) {
                                                                                                                                                                                                       console.error('[CRITICAL DATABASE FAILURE]: Failed to orchestrate ledger structure:', error);
                                                                                                                                                                                                         }
                                                                                                                                                                                                         }

                                                                                                                                                                                                         module.exports = {
                                                                                                                                                                                                           knex,
                                                                                                                                                                                                             initializeDatabaseSchema
                                                                                                                                                                                                             };