

/** @odoo-module **/
/*
 * This file is used to restrict out of stock product from ordering and show restrict popup
 */
import Orderline from 'point_of_sale.models';
import Order from 'point_of_sale.models';
import roundCurrency from 'point_of_sale.utils';

var PosDB = require('point_of_sale.DB');
var config = require('web.config');
var core = require('web.core');
var field_utils = require('web.field_utils');
var time = require('web.time');
var utils = require('web.utils');
var { Gui } = require('point_of_sale.Gui');
const { batched, uuidv4 } = require("point_of_sale.utils");
const { escape } = require("@web/core/utils/strings");
var QWeb = core.qweb;
var _t = core._t;
var round_di = utils.round_decimals;
var round_pr = utils.round_precision;
const Markup = utils.Markup;

Orderline.Orderline.prototype.constructor = function(obj, options) {
    // super(obj);
    this.pos = options.pos;
    this.order = options.order;
    this.price_manually_set = options.price_manually_set || false;
    this.price_automatically_set = options.price_automatically_set || false;
    if (options.json) {
        try {
            this.init_from_JSON(options.json);
        } catch (_error) {
            console.error('ERROR: attempting to recover product ID', options.json.product_id,
                'not available in the point of sale. Correct the product or clean the browser cache.');
        }
        return;
    }
    this.product = options.product;
    this.tax_ids = options.tax_ids;
    this.set_product_lot(this.product);
    this.set_quantity(1);
    this.discount = 0;
    this.discount_type = '';
    this.discountStr = '0';
    this.selected = false;
    this.description = '';
    this.price_extra = 0;
    this.full_product_name = options.description || '';
    this.id = orderline_id++;
    this.customerNote = this.customerNote || '';

    if (options.price) {
        this.set_unit_price(options.price);
    } else {
        this.set_unit_price(this.product.get_price(this.order.pricelist, this.get_quantity()));
    }
};

var rpc = require('web.rpc');

Orderline.Orderline.prototype.set_discount = function(discount) {
    var parsed_discount = typeof(discount) === 'number' ? discount : isNaN(parseFloat(discount)) ? 0 : field_utils.parse.float('' + discount);
    var disc;

    if (this.discount_type === 'percentage') {
        disc = Math.min(Math.max(parsed_discount || 0, 0), 100);
    } else {
        disc = parsed_discount;
    }

    this.discount = disc;

    var model = 'res.config.settings';
    var current = this;

    rpc.query({
        model: model,
        method: 'get_values',
    }).then(function(data) {
        let discountType = data.discount_type;
        let discountLimit = discountType === 'percentage' ? data.percentage_limit : data.fixed_limit;
        current.discount_type = discountType; 
        if (discountType == 'fixed') {
            current.discountStr = '' + disc;
            current.trigger('change',this);

        } else {
            current.discountStr = '' + disc + ' %';
            current.trigger('change',this);

        }
    });
};

Orderline.Orderline.prototype.get_base_price = function() {
    var rounding = this.pos.currency.rounding;
    if (this.discount_type == 'fixed') {
        return round_pr(this.get_unit_price() * this.get_quantity() * (this.get_discount()), rounding);
    }
    return round_pr(this.get_unit_price() * this.get_quantity() * (1 - this.get_discount() / 100), rounding);
};

Orderline.Orderline.prototype.get_display_price_one = function() {
    var rounding = this.pos.currency.rounding;
    var price_unit = this.get_unit_price();
    if (this.pos.config.iface_tax_included !== 'total') {
        if (this.discount_type == 'fixed') {
            console.log('get_price',price_unit,this.get_discount(),rounding,round_pr(price_unit - (this.get_discount()), rounding));
            return round_pr(price_unit - (this.get_discount()), rounding);
        }
        return round_pr(price_unit * (1.0 - (this.get_discount() / 100.0)), rounding);
    } else {
        var product = this.get_product();
        var taxes_ids = this.tax_ids || product.taxes_id;
        var product_taxes = this.pos.get_taxes_after_fp(taxes_ids, this.order.fiscal_position);
        var all_taxes = this.compute_all(product_taxes, price_unit, 1, this.pos.currency.rounding);
        if (this.discount_type == 'fixed') {
            console.log('get_price',round_pr(all_taxes.total_included -(this.get_discount()), rounding));
            return round_pr(all_taxes.total_included - (this.get_discount()), rounding);
        }
        return round_pr(all_taxes.total_included * (1 - this.get_discount() / 100), rounding);
    }
};

Orderline.Orderline.prototype.get_all_prices = function(qty = this.get_quantity()) {
    var price_unit = this.get_unit_price() * (1.0 - (this.get_discount() / 100.0));
    if (this.discount_type === 'fixed') {
        var price_unit = this.get_unit_price() - (this.get_discount());
    }
    var taxtotal = 0;

    var product = this.get_product();
    var taxes_ids = this.tax_ids || product.taxes_id;
    taxes_ids = _.filter(taxes_ids, t => t in this.pos.taxes_by_id);
    var taxdetail = {};
    var product_taxes = this.pos.get_taxes_after_fp(taxes_ids, this.order.fiscal_position);

    var all_taxes = this.compute_all(product_taxes, price_unit, qty, this.pos.currency.rounding);
    var all_taxes_before_discount = this.compute_all(product_taxes, this.get_unit_price(), qty, this.pos.currency.rounding);
    _(all_taxes.taxes).each(function(tax) {
        taxtotal += tax.amount;
        taxdetail[tax.id] = {
            amount: tax.amount,
            base: tax.base,
        };
    });

    return {
        "priceWithTax": all_taxes.total_included,
        "priceWithoutTax": all_taxes.total_excluded,
        "priceWithTaxBeforeDiscount": all_taxes_before_discount.total_included,
        "priceWithoutTaxBeforeDiscount": all_taxes_before_discount.total_excluded,
        "tax": taxtotal,
        "taxDetails": taxdetail,
        "tax_percentages": product_taxes.map((tax) => tax.amount),
    };
};

Orderline.Orderline.prototype._get_ignored_product_ids_total_discount = function() {
    // Define your logic here to retrieve the ignored product IDs
    // For example, you might retrieve them from the order or some configuration settings
    return [];
};

Orderline.Orderline.prototype.get_total_discount = function() {
    const ignored_product_ids = this._get_ignored_product_ids_total_discount();
    if (!this.order) {
        console.error("Order not defined for Orderline instance");
        return 0; // Return 0 if order is not defined
    }
    let totalDiscount = 0;

    (this.order.orderlines || []).forEach(orderLine => {
        if (!ignored_product_ids.includes(orderLine.product.id)) {
            if (this.discount_type === 'fixed') {
                totalDiscount += orderLine.get_discount() * orderLine.get_quantity();
                console.log(totalDiscount);
            }
            if (this.discount_type === 'percentage') {
                totalDiscount += (orderLine.getUnitDisplayPriceBeforeDiscount() * (orderLine.get_discount() / 100)) * orderLine.get_quantity();
                console.log(totalDiscount);

            }
        }
    });

    return totalDiscount;
};

Orderline.Orderline.prototype._reduce_total_discount_callback=function(sum, orderLine){
    if(this.discount_type=='fixed'){
        console.log('hiiiiiiii',discountUnitPrice)
        let discountUnitPrice = orderLine.getUnitDisplayPriceBeforeDiscount() - (orderLine.get_discount());
    }
    let discountUnitPrice = orderLine.getUnitDisplayPriceBeforeDiscount() * (orderLine.get_discount()/100);
    if (orderLine.display_discount_policy() === 'without_discount'){
        discountUnitPrice += orderLine.get_taxed_lst_unit_price() - orderLine.getUnitDisplayPriceBeforeDiscount();
    }
    console.log('llllllllllllllllllllllllllllll',sum + discountUnitPrice * orderLine.get_quantity())
    return sum + discountUnitPrice * orderLine.get_quantity();
}

 // returns the discount [0,100]%
 Orderline.Orderline.prototype.get_discount=function(){
    // console.log(this.discount)
    return this.discount;

}
Orderline.Orderline.prototype.get_discount_str=function(){
    // console.log(this.discountStr)
    return this.discountStr;
},
Orderline.Orderline.prototype.send_current_order_to_customer_facing_display= function() {
    var self = this;
    this.render_html_for_customer_facing_display().then(function (rendered_html) {
        if (self.env.pos.customer_display) {
            var $renderedHtml = $('<div>').html(rendered_html);
            $(self.env.pos.customer_display.document.body).html($renderedHtml.find('.pos-customer_facing_display'));
            var orderlines = $(self.env.pos.customer_display.document.body).find('.pos_orderlines_list');
            orderlines.scrollTop(orderlines.prop("scrollHeight"));
        } else if (self.env.pos.proxy.posbox_supports_display) {
            self.proxy.update_customer_facing_display(rendered_html);
        }
    });
},
Orderline.Orderline.prototype.render_html_for_customer_facing_display= function () {
    var self = this;
    var order = this.get_order();

    // If we're using an external device like the IoT Box, we
    // cannot get /web/image?model=product.product because the
    // IoT Box is not logged in and thus doesn't have the access
    // rights to access product.product. So instead we'll base64
    // encode it and embed it in the HTML.
    var get_image_promises = [];

    if (order) {
        order.get_orderlines().forEach(function (orderline) {
            var product = orderline.product;
            var image_url = `/web/image?model=product.product&field=image_128&id=${product.id}&write_date=${product.write_date}&unique=1`;

            // only download and convert image if we haven't done it before
            if (! product.image_base64) {
                get_image_promises.push(self._convert_product_img_to_base64(product, image_url));
            }
        });
    }

    return Promise.all(get_image_promises).then(function () {
        return QWeb.render('CustomerFacingDisplayOrder', {
            pos: self.env.pos,
            origin: window.location.origin,
            order: order,
        });
    });
},


Orderline.Orderline.prototype.export_for_printing = function() {
    return {
        id: this.id,
        quantity: this.get_quantity(),
        unit_name: this.get_unit().name,
        is_in_unit: this.get_unit().id == this.pos.uom_unit_id,
        price: this.get_unit_display_price(),
        discount_type: this.discount_type,
        discount: this.get_discount(),
        product_name: this.get_product().display_name,
        product_name_wrapped: this.generate_wrapped_product_name(),
        price_lst: this.get_taxed_lst_unit_price(),
        fixed_lst_price: this.get_fixed_lst_price(),
        price_manually_set: this.price_manually_set,
        price_automatically_set: this.price_automatically_set,
        display_discount_policy: this.display_discount_policy(),
        price_display_one: this.get_display_price_one(),
        price_display: this.get_display_price(),
        total_discount: this.get_total_discount(),
        price_with_tax: this.get_price_with_tax(),
        price_without_tax: this.get_price_without_tax(),
        price_with_tax_before_discount: this.get_price_with_tax_before_discount(),
        tax: this.get_tax(),
        // tax_percentages: this.get_tax_percentages(),
        product_description: this.get_product().description,
        product_description_sale: this.get_product().description_sale,
        pack_lot_lines: this.get_lot_lines(),
        customer_note: this.get_customer_note(),
        taxed_lst_unit_price: this.get_taxed_lst_unit_price(),
        unitDisplayPriceBeforeDiscount: this.getUnitDisplayPriceBeforeDiscount(),
    };
};
Orderline.Orderline.prototype.get_selected_orderline=function(){
    return this.selected_orderline;
},

Orderline.Orderline.prototype.export_as_JSON()= function() {
    var pack_lot_ids = [];
    if (this.has_product_lot){
        this.pack_lot_lines.forEach(item => {
            return pack_lot_ids.push([0, 0, item.export_as_JSON()]);
        });
    }
    console.log('dddddddddddddddddddddddd',this);
    return {
        qty: this.get_quantity(),
        price_unit: this.get_unit_price(),
        price_subtotal: this.get_price_without_tax(),
        price_subtotal_incl: this.get_price_with_tax(),
        discount: this.get_discount(),
        product_id: this.get_product().id,
        tax_ids: [[6, false, _.map(this.get_applicable_taxes(), function(tax){ return tax.id; })]],
        id: this.id,
        pack_lot_ids: pack_lot_ids,
        description: this.description,
        discount_type: this.discount_type,
        full_product_name: this.get_full_product_name()+' '+this.get_full_product_name(),
        price_extra: this.get_price_extra(),
        customer_note: this.get_customer_note(),
        refunded_orderline_id: this.refunded_orderline_id,
        price_manually_set: this.price_manually_set,
        price_automatically_set: this.price_automatically_set,
    };
}
