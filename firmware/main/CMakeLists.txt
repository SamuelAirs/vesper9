idf_component_register(SRCS "main.c" INCLUDE_DIRS "." REQUIRES esp_driver_gpio esp_driver_uart esp_driver_usb_serial_jtag esp_driver_i2s esp_driver_i2c esp_driver_ledc esp_driver_mcpwm esp_driver_rmt esp_timer)
# Board profile (hardware.h): idf.py -DNODE_BOARD=2 build. Default 1, the first node.
if(NOT DEFINED NODE_BOARD)
  set(NODE_BOARD 1)
endif()
target_compile_definitions(${COMPONENT_LIB} PRIVATE NODE_BOARD=${NODE_BOARD})
# Diagnostic: -DNODE_MIC2_MASTER=1 gives the second microphone its own clocks instead of the first one's.
if(NODE_MIC2_MASTER)
  target_compile_definitions(${COMPONENT_LIB} PRIVATE NODE_MIC2_MASTER=1)
endif()
