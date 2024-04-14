from datetime import timedelta
from functools import partial

import pytz
from odoo import api, models, fields,_
from odoo.osv.expression import AND

class PosDiscountNewTab(models.Model):
    _inherit = 'res.users'

    fixed_limit = fields.Float(string="Fixed Limit")
    percentage_limit = fields.Float(string="Percentage Limit")

class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    discount_type = fields.Selection([('percentage', 'Percentage'), ('fixed', 'Fixed')], string='Discount Type')
    percentage_limit = fields.Float(string='Percentage Limit')
    fixed_limit = fields.Float(string='Fixed Limit')
    session_id = fields.Many2one('pos.session', string='Session ID')

    @api.onchange('discount_type')
    def _onchange_discount_type(self):
        user = self.env.user
        if self.discount_type == 'percentage':
            self.fixed_limit = False
            self.percentage_limit = user.percentage_limit
        elif self.discount_type == 'fixed':
            self.fixed_limit = user.fixed_limit
            self.percentage_limit = False

    def set_values(self):
        super(ResConfigSettings, self).set_values()
        config = self.env['ir.config_parameter'].sudo()
        config.set_param('pos.discount_type', self.discount_type)
        config.set_param('pos.percentage_limit', self.percentage_limit)
        config.set_param('pos.fixed_limit', self.fixed_limit)
        config.set_param('pos.session_id', self.session_id.id)

        # Apply the new discount type and limit to the POS session
        if self.session_id:
            session = self.env['pos.session'].browse(self.session_id.id)
            session.discount_type = self.discount_type
            if self.discount_type == 'percentage':
                session.discount_limit = self.percentage_limit
                
            elif self.discount_type == 'fixed':
                session.discount_limit = self.fixed_limit

            # Close and open the session to apply the changes
            session.action_pos_session_closing_control()
            session.action_pos_session_opening_control()

    @api.model
    def get_values(self):
        res = super(ResConfigSettings, self).get_values()
        config = self.env['ir.config_parameter'].sudo()
        discount_type = config.get_param('pos.discount_type')
        percentage_limit = float(config.get_param('pos.percentage_limit'))
        fixed_limit = float(config.get_param('pos.fixed_limit'))
        res.update(
            discount_type=discount_type,
            percentage_limit=percentage_limit,
            fixed_limit=fixed_limit
        )
        return res

    @api.model
    def get_discount_limit(self, session_id):
        config = self.env['res.config.settings'].sudo().search([('session_id', '=', session_id)], limit=1).get_values()
        discount_type = config.get('discount_type')

        if config['discount_type'] == 'percentage':
            return config['percentage_limit']
        elif config['discount_type'] == 'fixed':
            return config['fixed_limit']
        return 0
    


class DiscountOrderType(models.Model):
    _inherit = 'pos.order'

    discount_selected = fields.Char( string='Discount Type' ,readonly=True)

    @api.model
    def _order_fields(self, ui_order):
        process_line = partial(self.env['pos.order.line']._order_line_fields, session_id=ui_order['pos_session_id'])
        config = self.env['res.config.settings'].sudo().get_values()
        discount_type = config.get('discount_type')
        
        
        return {
            'user_id':      ui_order['user_id'] or False,
            'session_id':   ui_order['pos_session_id'],
            'lines':        [process_line(l) for l in ui_order['lines']] if ui_order['lines'] else False,
            'pos_reference': ui_order['name'],
            'sequence_number': ui_order['sequence_number'],
            'partner_id':   ui_order['partner_id'] or False,
            'date_order':   ui_order['creation_date'].replace('T', ' ')[:19],
            'fiscal_position_id': ui_order['fiscal_position_id'],
            'pricelist_id': ui_order['pricelist_id'],
            'amount_paid':  ui_order['amount_paid'],
            'amount_total':  ui_order['amount_total'],
            'amount_tax':  ui_order['amount_tax'],
            'amount_return':  ui_order['amount_return'],
            'company_id': self.env['pos.session'].browse(ui_order['pos_session_id']).company_id.id,
            'to_invoice': ui_order['to_invoice'] if "to_invoice" in ui_order else False,
            'to_ship': ui_order['to_ship'] if "to_ship" in ui_order else False,
            'is_tipped': ui_order.get('is_tipped', False),
            'tip_amount': ui_order.get('tip_amount', 0),
            'discount_selected': discount_type,

        }
   
class PosOrderline(models.Model):
    _inherit = "pos.order.line"  

    limit_discount = fields.Char(string='Limit Discount', compute='_compute_limit_discount', store=True)

    @api.depends('order_id.discount_selected')
    def _compute_limit_discount(self):
        for line in self:
            line.limit_discount = line.order_id.discount_selected if line.order_id else ''


class ReportSaleDetails(models.AbstractModel):
    _inherit= 'report.point_of_sale.report_saledetails'

    @api.model
    def get_sale_details(self, date_start=False, date_stop=False, config_ids=False, session_ids=False):
        """ Serialise the orders of the requested time period, configs and sessions.

        :param date_start: The dateTime to start, default today 00:00:00.
        :type date_start: str.
        :param date_stop: The dateTime to stop, default date_start + 23:59:59.
        :type date_stop: str.
        :param config_ids: Pos Config id's to include.
        :type config_ids: list of numbers.
        :param session_ids: Pos Config id's to include.
        :type session_ids: list of numbers.

        :returns: dict -- Serialised sales.
        """
        domain = [('state', 'in', ['paid','invoiced','done'])]

        if (session_ids):
            domain = AND([domain, [('session_id', 'in', session_ids)]])
        else:
            if date_start:
                date_start = fields.Datetime.from_string(date_start)
            else:
                # start by default today 00:00:00
                user_tz = pytz.timezone(self.env.context.get('tz') or self.env.user.tz or 'UTC')
                today = user_tz.localize(fields.Datetime.from_string(fields.Date.context_today(self)))
                date_start = today.astimezone(pytz.timezone('UTC'))

            if date_stop:
                date_stop = fields.Datetime.from_string(date_stop)
                # avoid a date_stop smaller than date_start
                if (date_stop < date_start):
                    date_stop = date_start + timedelta(days=1, seconds=-1)
            else:
                # stop by default today 23:59:59
                date_stop = date_start + timedelta(days=1, seconds=-1)

            domain = AND([domain,
                [('date_order', '>=', fields.Datetime.to_string(date_start)),
                ('date_order', '<=', fields.Datetime.to_string(date_stop))]
            ])

            if config_ids:
                domain = AND([domain, [('config_id', 'in', config_ids)]])

        orders = self.env['pos.order'].search(domain)

        user_currency = self.env.company.currency_id

        total = 0.0
        products_sold = {}
        taxes = {}
        for order in orders:
            if user_currency != order.pricelist_id.currency_id:
                total += order.pricelist_id.currency_id._convert(
                    order.amount_total, user_currency, order.company_id, order.date_order or fields.Date.today())
            else:
                total += order.amount_total
            currency = order.session_id.currency_id

            for line in order.lines:
                key = (line.product_id, line.price_unit, line.discount)
                products_sold.setdefault(key, {'qty':0.0,'dis':''})
                products_sold[key]['qty'] += line.qty
                products_sold[key]['dis'] = order.discount_selected

                if line.tax_ids_after_fiscal_position:
                    line_taxes = line.tax_ids_after_fiscal_position.sudo().compute_all(line.price_unit * (1-(line.discount or 0.0)/100.0), currency, line.qty, product=line.product_id, partner=line.order_id.partner_id or False)
                    for tax in line_taxes['taxes']:
                        taxes.setdefault(tax['id'], {'name': tax['name'], 'tax_amount':0.0, 'base_amount':0.0})
                        taxes[tax['id']]['tax_amount'] += tax['amount']
                        taxes[tax['id']]['base_amount'] += tax['base']
                else:
                    taxes.setdefault(0, {'name': _('No Taxes'), 'tax_amount':0.0, 'base_amount':0.0})
                    taxes[0]['base_amount'] += line.price_subtotal_incl

        payment_ids = self.env["pos.payment"].search([('pos_order_id', 'in', orders.ids)]).ids
        if payment_ids:
            self.env.cr.execute("""
                SELECT method.name, sum(amount) total
                FROM pos_payment AS payment,
                     pos_payment_method AS method
                WHERE payment.payment_method_id = method.id
                    AND payment.id IN %s
                GROUP BY method.name
            """, (tuple(payment_ids),))
            payments = self.env.cr.dictfetchall()
        else:
            payments = []

        return {
            'currency_precision': user_currency.decimal_places,
            'total_paid': user_currency.round(total),
            'payments': payments,
            'company_name': self.env.company.name,
            'taxes': list(taxes.values()),
            'products': sorted([{
                'product_id': product.id,
                'product_name': product.name,
                'code': product.default_code,
                'quantity': qty['qty'],
                'price_unit': price_unit,
                'discount': discount,
                'discount_type': qty['dis'],
                'uom': product.uom_id.name,
            } for (product, price_unit, discount), qty in products_sold.items()], key=lambda l: l['product_name'])
        }
    
class orderReport(models.AbstractModel):
    _inherit= 'report.pos.order'

    def _select(self):
        return """
            SELECT
                MIN(l.id) AS id,
                COUNT(*) AS nbr_lines,
                s.date_order AS date,
                SUM(l.qty) AS product_qty,
                SUM(l.qty * l.price_unit / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END) AS price_sub_total,
                SUM(
                    CASE 
                        WHEN s.discount_selected = 'percentage' THEN ROUND((l.qty * l.price_unit) * (100 - l.discount) / 100 / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END, cu.decimal_places)
                        WHEN s.discount_selected = 'fixed' THEN ROUND((l.qty * l.price_unit) - (l.qty * l.discount) / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END, cu.decimal_places)
                        ELSE ROUND((l.qty * l.price_unit) * (100 - l.discount) / 100 / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END, cu.decimal_places)
 
                    END
                ) AS price_total,
                SUM(
                    CASE
                        WHEN s.discount_selected = 'percentage' THEN ROUND((l.qty * l.price_unit) * (l.discount / 100) / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END, cu.decimal_places)
                        WHEN s.discount_selected = 'fixed' THEN ROUND( (l.discount * l.qty) / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END, cu.decimal_places)
                        ELSE (l.qty * l.price_unit) * (l.discount / 100) / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END
                    END
                ) AS total_discount,
                CASE
                    WHEN SUM(l.qty * u.factor) = 0 THEN NULL
                    ELSE (SUM(l.qty * l.price_unit / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END) / SUM(l.qty * u.factor))::decimal
                END AS average_price,
                SUM(cast(to_char(date_trunc('day', s.date_order) - date_trunc('day', s.create_date), 'DD') AS INT)) AS delay_validation,
                s.id AS order_id,
                s.partner_id AS partner_id,
                s.state AS state,
                s.user_id AS user_id,
                s.company_id AS company_id,
                s.sale_journal AS journal_id,
                l.product_id AS product_id,
                pt.categ_id AS product_categ_id,
                p.product_tmpl_id,
                ps.config_id,
                pt.pos_categ_id,
                s.pricelist_id,
                s.session_id,
                s.account_move IS NOT NULL AS invoiced,
                SUM(l.price_subtotal - COALESCE(l.total_cost, 0) / CASE COALESCE(s.currency_rate, 0) WHEN 0 THEN 1.0 ELSE s.currency_rate END) AS margin
        """
