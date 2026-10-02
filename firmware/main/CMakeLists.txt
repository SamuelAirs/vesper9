idf_component_register(SRCS "main.c" INCLUDE_DIRS "." REQUIRES esp_driver_gpio esp_driver_uart esp_driver_usb_serial_jtag esp_driver_i2s esp_driver_i2c esp_driver_ledc esp_driver_mcpwm esp_timer)
# Board profile (hardware.h): idf.py -DNODE_BOARD=2 build. Default 1, the first node.
if(NOT DEFINED NODE_BOARD)
  set(NODE_BOARD 1)
endif()
target_compile_definitions(${COMPONENT_LIB} PRIVATE NODE_BOARD=${NODE_BOARD})
