// /** @odoo-module **/
// /*
//  * This file is used to restrict out of stock product from ordering and show restrict popup
//  */


/** @odoo-module **/
/*
 * This file is used to restrict out of stock product from ordering and show restrict popup
 */

import Registries from 'point_of_sale.Registries';
import ProductScreen from 'point_of_sale.ProductScreen';

const RestrictProductScreen = (ProductScreen) => class RestrictProductScreen extends ProductScreen {
   

    async _setValue(val) {
        if (this.currentOrder.get_selected_orderline()) {
            if (this.env.pos.numpadMode === 'quantity') {
                const result = this.currentOrder.get_selected_orderline().set_quantity(val);
                if (!result) NumberBuffer.reset();
            } else if (this.env.pos.numpadMode === 'discount') {
                var rpc = require('web.rpc');
                var model = 'res.config.settings';
                var current = this;

                rpc.query({
                    model: model,
                    method: 'get_values',
                }).then(function (data) {
                    console.log(val);
                    let discountType = data.discount_type;
                    let discountLimit = discountType === 'percentage' ? data.percentage_limit : data.fixed_limit;

                    

                    if (discountType === 'fixed') {
                        let total = current.currentOrder.get_selected_orderline().get_price_with_tax();
                        let currencySymbol = current.env.pos.currency.symbol;
                        let discountedTotal = total - parseFloat(val);
                        console.log(total)
                        console.log(currencySymbol+discountedTotal)
                        if(discountLimit && discountLimit < parseFloat(val)){
                            
                            current.showPopup('ErrorPopup', {
                                title: 'Restriction Error',
                                body: 'you are not allowed to add this much discount becouse'+ discountType === 'percentage' ? 'discount limit is :-'+ discountLimit : 'you are not allowed to add this much discount becouse fixed discount limit is :-'+ discountLimit
                            });
                            current.currentOrder.get_selected_orderline().set_discount(0); // Reset discount to 0
                            current.env.pos.numpadMode = null; // Reset numpad mode
                            return;

                        }
                        current.currentOrder.get_selected_orderline().set_discount(val);
                        // current.currentOrder.get_selected_orderline().set_discount(0); // Reset discount to 0
                        // current.currentOrder.get_selected_orderline().discount_selected = 'fixed'; // Update discount_selected field
                        // current.currentOrder.get_selected_orderline().set_unit_price(discountedTotal); // Apply fixed discount
                        return;
                       
                    } else if (discountLimit && discountLimit < parseFloat(val)) {
                        
                        current.showPopup('ErrorPopup', {
                            title: 'Restriction Error',
                            body: 'you are not allowed to add this much discount becouse percentage discount limit is :-'+ discountLimit 
                        });
                        current.currentOrder.get_selected_orderline().set_discount(0); // Reset discount to 0
                        current.env.pos.numpadMode = null; // Reset numpad mode
                        return;
                    } else {
                        current.currentOrder.get_selected_orderline().set_discount(val); // Set discount directly
                        return;
                    }
                });

            } else if (this.env.pos.numpadMode === 'price') {
                var selected_orderline = this.currentOrder.get_selected_orderline();
                selected_orderline.price_manually_set = true;
                selected_orderline.set_unit_price(val);
            }
            
        }
    }
    

}
Registries.Component.extend(ProductScreen, RestrictProductScreen);
