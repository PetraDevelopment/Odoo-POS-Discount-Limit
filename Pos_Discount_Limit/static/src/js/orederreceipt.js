odoo.define('Pos_Discount_Limit.receipt', function(require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class OrderReceipt extends PosComponent {
        setup() {
            super.setup();
            this._receiptEnv = this.props.order.getOrderReceiptEnv();

           
        }
        willUpdateProps(nextProps) {
            this._receiptEnv = nextProps.order.getOrderReceiptEnv();
        }

        get receipt() {
            return this.receiptEnv.receipt;
        }

        get orderlines() {
            return this.receiptEnv.orderlines;
        }

        get paymentlines() {
            return this.receiptEnv.paymentlines;
        }

        get isTaxIncluded() {
            return Math.abs(this.receipt.subtotal - this.receipt.total_with_tax) <= 0.000001;
        }

        get receiptEnv() {
            return this._receiptEnv;
        }

        isSimple(line) {
            return (
                line.discount === 0 &&
                line.is_in_unit &&
                line.quantity === 1 &&
                !(
                    line.display_discount_policy == 'without_discount' &&
                    line.price < line.price_lst
                )
            );

        }


        get_display_price_one(line) {
            if (line.discount_type === 'fixed') {
                console.log('hiiiiiiiiiiiiiiiiiiiiii',line.discountStr)

                return line.discountStr; // Return the fixed discount amount
            } else {
                return line.get_display_price_one(); // Return the regular display price for other cases
            }
        }

        get_total_discount() {
            let totalDiscount = 0;
            this.orderlines.forEach(line => {
                if (line.discount_type === 'fixed') {
                    totalDiscount += line.discount* line.get_quantity();
                } else if (line.discount_type === 'percentage') {
                    totalDiscount += (line.getUnitDisplayPriceBeforeDiscount() * (line.discount / 100)) * line.get_quantity();
                }
            });
            console.log(totalDiscount,'done')
            return totalDiscount;
        }
    }

    OrderReceipt.template = 'OrderReceipt';

    Registries.Component.add(OrderReceipt);

    return OrderReceipt;
});
