{
    'name': 'Pos Discount Limit',
     'author':'Petra Software',
    'company': 'Petra Software',
    'maintainer': 'Petra Software',
      'website':'www.t-petra.com',
       'license': 'LGPL-3',
    'depends': ['base', 'point_of_sale', 'web'],
    'data': [
        'views/pos_assets.xml',
        'views/dicsount_in_order_view.xml',
        'views/new_tab_inUser_views.xml',
        'views/pos_configration_dicount_views.xml',
        'views/sale_details_report.xml',
    ],
'images': ['static/description/banner.png'],
              'price':10,
    'currency':'USD',
    'qweb': [
        'static/src/xml/Orderlinelimits.xml',
        'static/src/xml/newreceipt.xml',
    ],
}
   
    

